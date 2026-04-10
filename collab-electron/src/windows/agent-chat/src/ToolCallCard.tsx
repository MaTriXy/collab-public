import { makeAssistantToolUI } from "@assistant-ui/react";

export const FallbackToolUI = makeAssistantToolUI({
  toolName: "*",
  render: ({ args, result, status }) => {
    const toolName =
      args && typeof args === "object" && "command" in args
        ? "bash"
        : "tool";

    return (
      <div
        className="my-2 rounded-lg border border-border bg-card p-3 font-mono text-xs"
      >
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background:
                status.type === "running" ? "#f59e0b" : "#22c55e",
            }}
          />
          <span>{toolName}</span>
        </div>
        {args && (
          <pre className="whitespace-pre-wrap break-all opacity-80">
            {JSON.stringify(args, null, 2)}
          </pre>
        )}
        {result !== undefined && (
          <details className="mt-2">
            <summary className="cursor-pointer text-muted-foreground">
              Result
            </summary>
            <pre className="mt-1 whitespace-pre-wrap break-all">
              {typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  },
});
