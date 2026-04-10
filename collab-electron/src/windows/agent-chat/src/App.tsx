import { useState, useEffect } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { AgentThread } from "./AgentThread";
import {
  useAcpRuntime,
  type ConnectResult,
} from "./use-acp-runtime";

export default function App() {
  const [connectResult, setConnectResult] =
    useState<ConnectResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Phase 1: connect to agent, get replay data
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      try {
        const params = new URLSearchParams(
          window.location.search,
        );
        const cwd = params.get("cwd") || ".";
        const result = await window.api.agentSpawn(cwd);
        if (cancelled) return;
        console.log(
          `[agent-chat] connected, resumed=${result.resumed}, replay=${result.replay?.length ?? 0}`,
        );
        setConnectResult(result as ConnectResult);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to connect",
        );
      }
    }

    connect();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-sm">
        <span className="text-destructive">
          {error}
        </span>
      </div>
    );
  }

  if (!connectResult) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Connecting to agent...
      </div>
    );
  }

  // Phase 2: render with runtime (replay data available)
  return <ConnectedChat connectResult={connectResult} />;
}

function ConnectedChat({
  connectResult,
}: {
  connectResult: ConnectResult;
}) {
  const { runtime } = useAcpRuntime(connectResult);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentThread />
    </AssistantRuntimeProvider>
  );
}
