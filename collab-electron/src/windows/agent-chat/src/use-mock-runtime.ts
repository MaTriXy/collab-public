import { useState, useCallback } from "react";
import {
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type AppendMessage,
} from "@assistant-ui/react";
import { MOCK_MESSAGES } from "./mock-data";

export function useMockRuntime() {
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] =
    useState<ThreadMessageLike[]>(MOCK_MESSAGES);

  const onNew = useCallback(async (message: AppendMessage) => {
    const textPart = message.content.find(
      (c) => c.type === "text",
    );
    if (!textPart || textPart.type !== "text") return;

    const userMsg: ThreadMessageLike = {
      role: "user",
      content: [{ type: "text", text: textPart.text }],
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsRunning(true);
    await new Promise((r) => setTimeout(r, 1500));

    const assistantMsg: ThreadMessageLike = {
      role: "assistant",
      content: [
        {
          type: "text",
          text:
            `Got it: "${textPart.text}"\n\n` +
            "This is a mock response. In Phase 2, this " +
            "will be connected to an ACP agent.",
        },
      ],
    };
    setMessages((prev) => [...prev, assistantMsg]);
    setIsRunning(false);
  }, []);

  return useExternalStoreRuntime({
    messages,
    setMessages,
    isRunning,
    onNew,
  });
}
