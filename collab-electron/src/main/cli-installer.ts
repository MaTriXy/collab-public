import { app } from "electron";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const IS_WIN = process.platform === "win32";
const INSTALL_DIR = IS_WIN
  ? join(
    process.env["LOCALAPPDATA"] || join(homedir(), "AppData", "Local"),
    "Collaborator",
    "bin",
  )
  : join(homedir(), ".local", "bin");
const WRAPPER_PATH = join(INSTALL_DIR, IS_WIN ? "collab-canvas.cmd" : "collab-canvas");
const MJS_PATH = join(INSTALL_DIR, "collab-cli.mjs");
const COLLAB_DIR = join(homedir(), ".collaborator");
const HINT_MARKER = join(COLLAB_DIR, "cli-path-hinted");

function getMjsSource(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "collab-cli.mjs");
  }
  return join(app.getAppPath(), "cli", "collab-cli.mjs");
}

function generateUnixWrapper(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
NODE_BIN="$(cat "$HOME/.collaborator/node-path" 2>/dev/null)" || true
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "error: collaborator is not running (no node-path file)" >&2
  exit 2
fi
ELECTRON_RUN_AS_NODE=1 exec "$NODE_BIN" "$(dirname "$0")/collab-cli.mjs" "$@"
`;
}

function generateWindowsWrapper(): string {
  return `@echo off
setlocal
set "NP_FILE=%USERPROFILE%\\.collaborator\\node-path"
if not exist "%NP_FILE%" (
  echo error: collaborator is not running ^(no node-path file^) >&2
  exit /b 2
)
set /p NODE_BIN=<"%NP_FILE%"
set ELECTRON_RUN_AS_NODE=1
"%NODE_BIN%" "%~dp0collab-cli.mjs" %*
`;
}

export function installCli(): void {
  const mjsSource = getMjsSource();
  if (!existsSync(mjsSource)) {
    console.warn("[cli-installer] CLI source not found:", mjsSource);
    return;
  }

  const legacyNames = IS_WIN
    ? ["collab.cmd", "collab.ps1"]
    : ["collab"];
  for (const name of legacyNames) {
    const legacy = join(INSTALL_DIR, name);
    if (existsSync(legacy)) {
      unlinkSync(legacy);
      console.log("[cli-installer] removed legacy CLI:", legacy);
    }
  }

  mkdirSync(INSTALL_DIR, { recursive: true });

  copyFileSync(mjsSource, MJS_PATH);

  const wrapper = IS_WIN ? generateWindowsWrapper() : generateUnixWrapper();
  writeFileSync(WRAPPER_PATH, wrapper, "utf-8");
  if (!IS_WIN) {
    chmodSync(WRAPPER_PATH, 0o755);
  }

  if (!existsSync(HINT_MARKER)) {
    const pathEnv = process.env["PATH"] ?? "";
    const separator = IS_WIN ? ";" : ":";
    if (!pathEnv.split(separator).includes(INSTALL_DIR)) {
      const hint = IS_WIN
        ? `[cli-installer] collab-canvas installed to ${WRAPPER_PATH}. ` +
          `Add ${INSTALL_DIR} to your PATH to use it from any terminal.`
        : `[cli-installer] collab-canvas installed to ${WRAPPER_PATH}. ` +
          `Add ~/.local/bin to your PATH to use it from any terminal:\n` +
          `  export PATH="$HOME/.local/bin:$PATH"`;
      console.log(hint);
      mkdirSync(COLLAB_DIR, { recursive: true });
      writeFileSync(HINT_MARKER, "", "utf-8");
    }
  }
}
