import { useState, useEffect, useRef } from "react";
import {
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunResult,
} from "@assistant-ui/react";

type AcpUpdate = {
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
      ) => Promise<{ sessionId: string }>;
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

export function useAcpRuntime() {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const adapter = createAcpAdapter(sessionIdRef);
  const runtime = useLocalRuntime(adapter);

  // Connect to agent on mount
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      setStatus("connecting");
      try {
        const params = new URLSearchParams(
          window.location.search,
        );
        const cwd = params.get("cwd") || ".";
        const result = await window.api.agentSpawn(cwd);
        if (cancelled) return;
        sessionIdRef.current = result.sessionId;
        setStatus("ready");
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error
          ? err.message
          : "Failed to connect";
        setError(msg);
        setStatus("error");
      }
    }

    connect();
    return () => { cancelled = true; };
  }, []);

  return { runtime, status, error };
}
