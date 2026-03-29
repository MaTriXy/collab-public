import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const builderArgs = ["--publish", "never"];
const env = { ...process.env };
const cwd = process.cwd();

if (args.includes("--publish")) {
  builderArgs.splice(0, builderArgs.length, "--publish", "always");
}

if (args.includes("--no-sign")) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  env.SKIP_NOTARIZE = "true";
  builderArgs.push("-c.win.signAndEditExecutable=false");
  builderArgs.push("-c.mac.identity=null");
}

function run(command, commandArgs, extraEnv = env) {
  const result = spawnSync(
    command,
    commandArgs,
    {
      stdio: "inherit",
      cwd,
      env: extraEnv,
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function binPath(name) {
  return join(
    cwd,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${name}.exe` : name,
  );
}

function detectMismatchedToolchain(expectedName) {
  const expected = binPath(expectedName);
  const opposite = join(
    cwd,
    "node_modules",
    ".bin",
    process.platform === "win32" ? expectedName : `${expectedName}.exe`,
  );

  if (existsSync(expected)) {
    return expected;
  }

  if (existsSync(opposite)) {
    console.error(
      `Detected ${process.platform === "win32" ? "non-Windows" : "Windows"}-installed tooling in a ${process.platform} packaging environment.`,
    );
    console.error(
      "Run `bun run clean:deep` and reinstall dependencies in a native checkout for this OS before packaging.",
    );
    process.exit(1);
  }

  console.error(`Missing local binary: ${expected}`);
  console.error("Run `bun install` in this checkout before packaging.");
  process.exit(1);
}

const electronVite = detectMismatchedToolchain("electron-vite");
const electronBuilder = detectMismatchedToolchain("electron-builder");

run(
  electronVite,
  ["build"],
);

run(electronBuilder, builderArgs);
