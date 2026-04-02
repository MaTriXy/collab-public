import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { format } from "node:util";
import { COLLAB_DIR } from "./paths";

const MAIN_LOG_PATH = join(COLLAB_DIR, "logs", "main.log");
const PATCHED = Symbol.for("collaborator.mainLogger.patched");

type ConsoleMethod =
  | "log"
  | "info"
  | "warn"
  | "error"
  | "debug";

function writeLine(level: ConsoleMethod, args: unknown[]): void {
  try {
    mkdirSync(dirname(MAIN_LOG_PATH), { recursive: true });
    appendFileSync(
      MAIN_LOG_PATH,
      `[${new Date().toISOString()}] [${level}] ${format(...args)}\n`,
      "utf8",
    );
  } catch {
    // Never let logging failures affect app startup or runtime behavior.
  }
}

function patchConsole(method: ConsoleMethod): void {
  const original = console[method].bind(console);

  console[method] = (...args: unknown[]) => {
    writeLine(method, args);
    original(...args);
  };
}

if (!(globalThis as Record<PropertyKey, unknown>)[PATCHED]) {
  (globalThis as Record<PropertyKey, unknown>)[PATCHED] = true;

  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    patchConsole(method);
  }
}

export { MAIN_LOG_PATH };
