import { spawn, type ChildProcess } from "node:child_process";
import { Writable, Readable } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { app, ipcMain, type BrowserWindow } from "electron";
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  getPref, setPref, type AppConfig,
} from "./config";

type AgentSession = {
  sessionId: string;
  connection: ClientSideConnection;
  process: ChildProcess;
};

const PREF_SESSION_ID = "agent-acp-session-id";
const PREF_SESSION_CWD = "agent-acp-session-cwd";

const sessions = new Map<string, AgentSession>();
let shellWindow: BrowserWindow | null = null;
let appConfig: AppConfig | null = null;

function sendToRenderer(
  channel: string, ...args: unknown[]
): void {
  if (shellWindow && !shellWindow.isDestroyed()) {
    shellWindow.webContents.send(channel, ...args);
  }
}

type ReplayCollector = {
  messages: SessionNotification[];
};

let replayCollector: ReplayCollector | null = null;

function createClient(): Client {
  return {
    async sessionUpdate(
      params: SessionNotification,
    ): Promise<void> {
      // During loadSession, collect replayed messages
      // instead of forwarding to renderer
      if (replayCollector) {
        replayCollector.messages.push(params);
        return;
      }

      sendToRenderer("agent:update", params);
    },

    async requestPermission(
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> {
      const allow = params.options.find(
        (o) => o.kind === "allow_once",
      );
      return {
        outcome: {
          outcome: "selected",
          optionId:
            allow?.optionId ?? params.options[0].optionId,
        },
      };
    },

    async readTextFile(
      params: ReadTextFileRequest,
    ): Promise<ReadTextFileResponse> {
      const content = await readFile(params.path, "utf-8");
      return { content };
    },

    async writeTextFile(
      params: WriteTextFileRequest,
    ): Promise<WriteTextFileResponse> {
      await writeFile(params.path, params.content, "utf-8");
      return {};
    },
  };
}

function findAgentBinary(): string {
  const base = app.isPackaged
    ? resolve(app.getAppPath(), "..")
    : resolve(app.getAppPath());
  return resolve(
    base, "node_modules/.bin/claude-agent-acp",
  );
}

function saveSessionPref(
  sessionId: string, cwd: string,
): void {
  if (!appConfig) return;
  setPref(appConfig, PREF_SESSION_ID, sessionId);
  setPref(appConfig, PREF_SESSION_CWD, cwd);
}

function clearSessionPref(): void {
  if (!appConfig) return;
  setPref(appConfig, PREF_SESSION_ID, null);
  setPref(appConfig, PREF_SESSION_CWD, null);
}

async function spawnAndInitialize(
  cwd: string,
): Promise<{ connection: ClientSideConnection; proc: ChildProcess }> {
  const bin = findAgentBinary();
  const proc = spawn(bin, [], {
    stdio: ["pipe", "pipe", "inherit"],
    cwd,
    env: {
      ...process.env,
      ACP_PERMISSION_MODE: "acceptEdits",
    },
  });

  const input = Writable.toWeb(
    proc.stdin!,
  ) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(
    proc.stdout!,
  ) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);

  const connection = new ClientSideConnection(
    () => createClient(),
    stream,
  );

  await connection.initialize({
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
    },
    clientInfo: {
      name: "collaborator",
      title: "Collaborator",
      version: "1.0.0",
    },
  });

  return { connection, proc };
}

function registerSession(
  sessionId: string,
  connection: ClientSideConnection,
  proc: ChildProcess,
  cwd: string,
): void {
  sessions.set(sessionId, {
    sessionId,
    connection,
    process: proc,
  });

  saveSessionPref(sessionId, cwd);

  proc.on("exit", () => {
    sessions.delete(sessionId);
    sendToRenderer("agent:exit", { sessionId });
  });
}

export async function spawnAgent(
  cwd: string,
): Promise<{ sessionId: string; resumed: boolean }> {
  // Try to resume a previous session
  const savedId = appConfig
    ? (getPref(appConfig, PREF_SESSION_ID) as string)
    : null;
  const savedCwd = appConfig
    ? (getPref(appConfig, PREF_SESSION_CWD) as string)
    : null;

  const { connection, proc } = await spawnAndInitialize(
    cwd,
  );

  if (savedId) {
    try {
      replayCollector = { messages: [] };
      await connection.loadSession({
        sessionId: savedId,
        cwd: savedCwd ?? cwd,
        mcpServers: [],
      });
      const replay = replayCollector.messages;
      replayCollector = null;
      registerSession(savedId, connection, proc, cwd);
      return {
        sessionId: savedId,
        resumed: true,
        replay,
      };
    } catch (err) {
      replayCollector = null;
      clearSessionPref();
    }
  }

  // Fresh session
  const session = await connection.newSession({
    cwd,
    mcpServers: [],
  });
  const sessionId = session.sessionId;
  registerSession(sessionId, connection, proc, cwd);
  return { sessionId, resumed: false };
}

export async function promptAgent(
  sessionId: string,
  text: string,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`No agent session: ${sessionId}`);
  }

  try {
    const result = await session.connection.prompt({
      sessionId,
      prompt: [{ type: "text", text }],
    });
    sendToRenderer("agent:prompt-complete", {
      sessionId,
      stopReason: result.stopReason,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error
      ? err.message
      : "Unknown error";
    sendToRenderer("agent:prompt-error", {
      sessionId,
      error: msg,
    });
  }
}

export async function cancelAgent(
  sessionId: string,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  await session.connection.cancel({ sessionId });
}

export function killAgent(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.process.kill();
  sessions.delete(sessionId);
  // Don't clear prefs — allow resume on next start
}

export function killAllAgents(): void {
  for (const session of sessions.values()) {
    session.process.kill();
  }
  sessions.clear();
}

export function registerAgentIpc(
  win: BrowserWindow,
  cfg: AppConfig,
): void {
  shellWindow = win;
  appConfig = cfg;

  ipcMain.handle(
    "agent:spawn",
    async (
      _event: unknown,
      { cwd }: { cwd: string },
    ) => {
      const result = await spawnAgent(cwd);
      return result;
    },
  );

  ipcMain.handle(
    "agent:prompt",
    async (
      _event: unknown,
      { sessionId, text }: {
        sessionId: string; text: string;
      },
    ) => {
      // Fire-and-forget: promptAgent streams updates
      // via IPC notifications, resolves when done
      promptAgent(sessionId, text);
      return {};
    },
  );

  ipcMain.handle(
    "agent:cancel",
    async (
      _event: unknown,
      { sessionId }: { sessionId: string },
    ) => {
      await cancelAgent(sessionId);
      return {};
    },
  );

  ipcMain.handle(
    "agent:kill",
    async (
      _event: unknown,
      { sessionId }: { sessionId: string },
    ) => {
      killAgent(sessionId);
      return {};
    },
  );

  win.on("closed", () => {
    killAllAgents();
    shellWindow = null;
  });
}
