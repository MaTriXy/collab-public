import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAcpRuntime } from "./use-acp-runtime";
import { AgentThread } from "./AgentThread";

export default function App() {
  const { runtime, status, error } = useAcpRuntime();

  if (status === "connecting") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Connecting to agent...
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-sm">
        <span className="text-destructive">
          {error ?? "Connection failed"}
        </span>
      </div>
    );
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentThread />
    </AssistantRuntimeProvider>
  );
}
