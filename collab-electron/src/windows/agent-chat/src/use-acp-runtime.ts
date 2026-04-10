import { useState, useEffect, useRef, useMemo } from "react";
import {
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunResult,
} from "@assistant-ui/react";

export type AcpUpdate = {
  sessionId: string;
  update: {
    sessionUpdate: string;
    content?:
      | { type: string; text?: string }
      | Array<{
        type: string;
        content?: { type: string; text?: string };
      }>;
    toolCallId?: string;
    title?: string;
    kind?: string;
    status?: string;
    rawInput?: unknown;
    rawOutput?: unknown;
  };
};

declare global {
  interface Window {
    api: {
      agentSpawn: (
        cwd: string,
      ) => Promise<{
        sessionId: string;
        resumed: boolean;
        replay?: AcpUpdate[];
      }>;
      agentPrompt: (
        sessionId: string, text: string,
      ) => Promise<void>;
      agentCancel: (
        sessionId: string,
      ) => Promise<void>;
      agentKill: (
        sessionId: string,
      ) => Promise<void>;
      onAgentUpdate: (
        cb: (params: AcpUpdate) => void,
      ) => () => void;
      onAgentPromptComplete: (
        cb: (data: {
          sessionId: string; stopReason: string;
        }) => void,
      ) => () => void;
      onAgentPromptError: (
        cb: (data: {
          sessionId: string; error: string;
        }) => void,
      ) => () => void;
      onAgentExit: (
        cb: (data: { sessionId: string }) => void,
      ) => () => void;
      sendToHost: (
        channel: string, ...args: unknown[]
      ) => void;
    };
  }
}

export type AgentStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "error";

type ThreadMessageLike = {
  role: "user" | "assistant";
  content: Array<
    | { type: "text"; text: string }
    | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      result?: unknown;
    }
  >;
};

/**
 * Parse ACP session replay notifications into
 * ThreadMessageLike messages for the UI.
 */
function parseReplay(
  replay: AcpUpdate[],
): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = [];
  let currentParts: ThreadMessageLike["content"] = [];
  let currentRole: "user" | "assistant" | null = null;

  function flush() {
    if (currentRole && currentParts.length > 0) {
      messages.push({
        role: currentRole,
        content: [...currentParts],
      });
    }
    currentParts = [];
    currentRole = null;
  }

  for (const item of replay) {
    const update = item.update;
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        if (currentRole !== "user") flush();
        currentRole = "user";
        const chunk = update.content;
        const text = chunk && !Array.isArray(chunk)
          ? chunk.text
          : undefined;
        if (text) {
          const last = currentParts[
            currentParts.length - 1
          ];
          if (last?.type === "text") {
            last.text += text;
          } else {
            currentParts.push({
              type: "text", text,
            });
          }
        }
        break;
      }
      case "agent_message_chunk": {
        if (currentRole !== "assistant") flush();
        currentRole = "assistant";
        const chunk = update.content;
        const text = chunk && !Array.isArray(chunk)
          ? chunk.text
          : undefined;
        if (text) {
          const last = currentParts[
            currentParts.length - 1
          ];
          if (last?.type === "text") {
            last.text += text;
          } else {
            currentParts.push({
              type: "text", text,
            });
          }
        }
        break;
      }
      case "tool_call": {
        if (currentRole !== "assistant") flush();
        currentRole = "assistant";
        currentParts.push({
          type: "tool-call",
          toolCallId:
            update.toolCallId ?? `tc_${Date.now()}`,
          toolName: update.title ?? "tool",
          args:
            (update.rawInput as Record<
              string, unknown
            >) ?? {},
        });
        break;
      }
      case "tool_call_update": {
        const tc = currentParts.find(
          (p) =>
            p.type === "tool-call" &&
            p.toolCallId === update.toolCallId,
        );
        if (tc && tc.type === "tool-call") {
          const raw = update.content;
          if (
            Array.isArray(raw) && raw.length > 0
          ) {
            const first = raw[0];
            if (
              first.type === "content" &&
              first.content?.text
            ) {
              tc.result = first.content.text;
            }
          }
          if (!tc.result && update.rawOutput) {
            tc.result = update.rawOutput;
          }
        }
        break;
      }
    }
  }
  flush();
  return messages;
}

/**
 * ChatModelAdapter that bridges ACP IPC events into
 * assistant-ui's streaming protocol.
 */
function createAcpAdapter(
  sessionIdRef: React.RefObject<string | null>,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        yield { content: [{ type: "text", text: "Not connected to agent" }] };
        return;
      }

      const lastMsg = messages[messages.length - 1];
      const textPart = lastMsg?.content.find(
        (c: any) => c.type === "text",
      );
      const text = textPart?.type === "text"
        ? (textPart as any).text
        : "";

      if (!text) return;

      // Set up listeners before sending the prompt
      let textAccum = "";
      const toolCalls: Array<{
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
        result?: unknown;
      }> = [];

      let resolveComplete: () => void;
      let rejectComplete: (err: Error) => void;
      const completionPromise = new Promise<void>(
        (res, rej) => {
          resolveComplete = res;
          rejectComplete = rej;
        },
      );

      const cleanups: Array<() => void> = [];

      cleanups.push(
        window.api.onAgentUpdate((params: AcpUpdate) => {
          const update = params.update;

          switch (update.sessionUpdate) {
            case "agent_message_chunk": {
              const chunk = update.content;
              const t = chunk && !Array.isArray(chunk)
                ? chunk.text
                : undefined;
              if (t) textAccum += t;
              break;
            }
            case "tool_call": {
              toolCalls.push({
                toolCallId:
                  update.toolCallId ?? `tc_${Date.now()}`,
                toolName: update.title ?? "tool",
                args:
                  (update.rawInput as Record<
                    string, unknown
                  >) ?? {},
              });
              break;
            }
            case "tool_call_update": {
              const tc = toolCalls.find(
                (t) => t.toolCallId === update.toolCallId,
              );
              if (tc) {
                const raw = update.content;
                if (
                  Array.isArray(raw) &&
                  raw.length > 0
                ) {
                  const first = raw[0];
                  if (
                    first.type === "content" &&
                    first.content?.text
                  ) {
                    tc.result = first.content.text;
                  }
                }
                if (!tc.result && update.rawOutput) {
                  tc.result = update.rawOutput;
                }
              }
              break;
            }
          }
        }),
      );

      cleanups.push(
        window.api.onAgentPromptComplete(() => {
          resolveComplete();
        }),
      );

      cleanups.push(
        window.api.onAgentPromptError((data) => {
          rejectComplete(new Error(data.error));
        }),
      );

      // Send the prompt
      window.api.agentPrompt(sessionId, text);

      // Yield updates periodically until complete
      try {
        let lastYieldedLen = 0;
        while (true) {
          // Check if aborted
          if (abortSignal?.aborted) {
            window.api.agentCancel(sessionId);
            break;
          }

          // Check if complete
          const done = await Promise.race([
            completionPromise.then(() => true),
            new Promise<false>((r) =>
              setTimeout(() => r(false), 100),
            ),
          ]);

          // Yield current state if text changed
          if (textAccum.length > lastYieldedLen || done) {
            lastYieldedLen = textAccum.length;
            const content: ChatModelRunResult["content"] =
              [];
            if (textAccum) {
              content.push({
                type: "text",
                text: textAccum,
              });
            }
            for (const tc of toolCalls) {
              content.push({
                type: "tool-call",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                args: tc.args,
                result: tc.result,
              });
            }
            yield { content };
          }

          if (done) break;
        }
      } finally {
        for (const fn of cleanups) fn();
      }
    },
  };
}

export type ConnectResult = {
  sessionId: string;
  resumed: boolean;
  replay?: AcpUpdate[];
};

export function useAcpRuntime(
  connectResult: ConnectResult,
) {
  const sessionIdRef = useRef<string | null>(
    connectResult.sessionId,
  );

  // Parse replay into initial messages
  const initialMessages = useMemo(() => {
    if (
      !connectResult.resumed ||
      !connectResult.replay?.length
    ) {
      return undefined;
    }
    const parsed = parseReplay(connectResult.replay);
    console.log(
      `[agent-chat] initialMessages: ${parsed.length}`,
    );
    return parsed.length > 0 ? parsed : undefined;
  }, []);

  const adapter = createAcpAdapter(sessionIdRef);
  const runtime = useLocalRuntime(adapter, {
    initialMessages,
  });

  return { runtime };
}
