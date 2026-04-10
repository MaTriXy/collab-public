import type { ThreadMessageLike } from "@assistant-ui/react";

export const MOCK_MESSAGES: ThreadMessageLike[] = [
  {
    role: "user",
    content: [
      {
        type: "text",
        text: "Find all TODO comments in the src directory.",
      },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "I'll search for TODO comments across the source files.",
      },
      {
        type: "tool-call",
        toolCallId: "call_001",
        toolName: "bash",
        args: {
          command:
            "grep -rn 'TODO' src/ --include='*.ts' --include='*.tsx'",
        },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_001",
        result:
          "src/main/index.ts:42: // TODO: Add error handling\n" +
          "src/windows/shell/src/renderer.js:156: // TODO: Debounce resize\n" +
          "src/preload/universal.ts:89: // TODO: Clean up listener",
      },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text:
          "Found 3 TODO comments:\n\n" +
          "| File | Line | TODO |\n" +
          "|------|------|------|\n" +
          "| `src/main/index.ts` | 42 | Add error handling |\n" +
          "| `renderer.js` | 156 | Debounce resize |\n" +
          "| `universal.ts` | 89 | Clean up listener |\n\n" +
          "Want me to address any of these?",
      },
    ],
  },
  {
    role: "user",
    content: [
      { type: "text", text: "Fix the debounce one." },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Let me read the context around that TODO first.",
      },
      {
        type: "tool-call",
        toolCallId: "call_002",
        toolName: "read_file",
        args: {
          path: "src/windows/shell/src/renderer.js",
          startLine: 150,
          endLine: 160,
        },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_002",
        result:
          "150: function onResize() {\n" +
          "151:   // TODO: Debounce resize events\n" +
          "152:   updateLayout();\n" +
          "153: }",
      },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Applying the fix with a debounce wrapper:",
      },
      {
        type: "tool-call",
        toolCallId: "call_003",
        toolName: "edit_file",
        args: {
          path: "src/windows/shell/src/renderer.js",
          old: "function onResize() {\n  // TODO: Debounce\n  updateLayout();\n}",
          new: "const onResize = debounce(() => {\n  updateLayout();\n}, 150);",
        },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_003",
        result: "File edited successfully.",
      },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text:
          "Done. Replaced the raw `onResize` handler with a " +
          "debounced version (150ms delay).",
      },
    ],
  },
];
