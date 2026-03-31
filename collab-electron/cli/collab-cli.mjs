#!/usr/bin/env node
import { createConnection } from "node:net";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const VERSION = "0.1.0";
const GRID = 20;
const COLLAB_DIR = join(homedir(), ".collaborator");
const SOCKET_FILE = join(COLLAB_DIR, "socket-path");

// --- helpers --------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

function readSocketPath() {
  let raw;
  try {
    raw = readFileSync(SOCKET_FILE, "utf-8").trim();
  } catch {
    die("collaborator is not running (no socket-path file)", 2);
  }
  return raw;
}

function rpcCall(method, params = {}) {
  return new Promise((res, rej) => {
    const socketPath = readSocketPath();
    const payload =
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n";

    const sock = createConnection(socketPath);
    let buf = "";

    const timer = setTimeout(() => {
      sock.destroy();
      rej(new Error("timeout"));
    }, 10_000);

    sock.on("connect", () => sock.write(payload));

    sock.on("data", (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      sock.destroy();
      let resp;
      try {
        resp = JSON.parse(buf.slice(0, nl));
      } catch {
        rej(new Error("invalid response from collaborator"));
        return;
      }
      if (resp.error) {
        rej(new Error(resp.error.message ?? "unknown error"));
      } else {
        res(resp.result);
      }
    });

    sock.on("error", (err) => {
      clearTimeout(timer);
      rej(err);
    });
  });
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function tilesToGrid(result) {
  for (const t of result.tiles ?? []) {
    if (t.position) {
      t.position.x = Math.floor(t.position.x / GRID);
      t.position.y = Math.floor(t.position.y / GRID);
    }
    if (t.size) {
      t.size.width = Math.floor(t.size.width / GRID);
      t.size.height = Math.floor(t.size.height / GRID);
    }
  }
  return result;
}

function parsePos(s) {
  const [xs, ys] = s.split(",");
  const x = Number(xs);
  const y = Number(ys);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    die(`invalid position: ${s}`);
  }
  return { x, y };
}

function parseSize(s) {
  const [ws, hs] = s.split(",");
  const w = Number(ws);
  const h = Number(hs);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 0 || h < 0) {
    die(`invalid size: ${s}`);
  }
  return { w, h };
}

// --- subcommands ----------------------------------------------------------

async function cmdTileList() {
  const result = await rpcCall("canvas.tileList");
  console.log(pretty(tilesToGrid(result)));
}

async function cmdTileCreate(args) {
  if (args.length === 0) {
    die("tile create requires a type (term, note, code, image, graph)");
  }
  const tileType = args.shift();
  const valid = ["term", "note", "code", "image", "graph"];
  if (!valid.includes(tileType)) {
    die(`unknown tile type: ${tileType} (expected: ${valid.join(", ")})`);
  }

  const params = { tileType };
  while (args.length > 0) {
    const flag = args.shift();
    switch (flag) {
      case "--file": {
        if (args.length === 0) die("--file requires a path");
        params.filePath = resolve(args.shift());
        break;
      }
      case "--pos": {
        if (args.length === 0) die("--pos requires x,y");
        const { x, y } = parsePos(args.shift());
        params.position = { x: x * GRID, y: y * GRID };
        break;
      }
      case "--size": {
        if (args.length === 0) die("--size requires w,h");
        const { w, h } = parseSize(args.shift());
        params.size = { width: w * GRID, height: h * GRID };
        break;
      }
      default:
        die(`unknown option: ${flag}`);
    }
  }

  const result = await rpcCall("canvas.tileCreate", params);
  console.log(result.tileId);
}

async function cmdTileRm(args) {
  if (args.length === 0) die("tile rm requires a tile id");
  const tileId = args[0];
  await rpcCall("canvas.tileRemove", { tileId });
  console.log(`removed ${tileId}`);
}

async function cmdTileMove(args) {
  if (args.length === 0) die("tile move requires a tile id");
  const tileId = args.shift();
  let pos = null;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--pos") {
      if (args.length === 0) die("--pos requires x,y");
      pos = parsePos(args.shift());
    } else {
      die(`unknown option: ${flag}`);
    }
  }
  if (!pos) die("tile move requires --pos x,y");

  await rpcCall("canvas.tileMove", {
    tileId,
    position: { x: pos.x * GRID, y: pos.y * GRID },
  });
  console.log(`moved ${tileId} to ${pos.x},${pos.y}`);
}

async function cmdTileResize(args) {
  if (args.length === 0) die("tile resize requires a tile id");
  const tileId = args.shift();
  let size = null;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--size") {
      if (args.length === 0) die("--size requires w,h");
      size = parseSize(args.shift());
    } else {
      die(`unknown option: ${flag}`);
    }
  }
  if (!size) die("tile resize requires --size w,h");

  await rpcCall("canvas.tileResize", {
    tileId,
    size: { width: size.w * GRID, height: size.h * GRID },
  });
  console.log(`resized ${tileId} to ${size.w},${size.h}`);
}

async function cmdTileFocus(args) {
  if (args.length === 0) die("tile focus requires at least one tile id");
  await rpcCall("canvas.tileFocus", { tileIds: args });
  console.log(`focused ${args.join(" ")}`);
}

async function cmdTerminalWrite(args) {
  if (args.length < 2) die("terminal write requires <id> <input>");
  const tileId = args[0];
  const input = args[1];
  await rpcCall("canvas.terminalWrite", { tileId, input });
  console.log(`wrote to ${tileId}`);
}

async function cmdTerminalRead(args) {
  if (args.length === 0) die("terminal read requires a tile id");
  const tileId = args.shift();
  let lines = 50;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--lines") {
      if (args.length === 0) die("--lines requires a number");
      lines = Number(args.shift());
      if (!Number.isInteger(lines) || lines <= 0) die("--lines must be a positive integer");
    } else {
      die(`unknown option: ${flag}`);
    }
  }

  const result = await rpcCall("canvas.terminalRead", { tileId, lines });
  console.log(pretty(result));
}

// --- usage ----------------------------------------------------------------

function usage() {
  console.log(`collab — control the Collaborator canvas from the command line

USAGE
  collab <command> [options]

COMMANDS
  tile list                          List all tiles on the canvas
  tile create <type> [options]       Create a new tile
  tile rm <id>                       Remove a tile
  tile move <id> --pos x,y           Move a tile
  tile resize <id> --size w,h        Resize a tile
  tile focus <id> [<id>...]          Bring tiles into view
  terminal write <id> <input>        Send input to a terminal tile
  terminal read <id> [--lines N]     Read output from a terminal tile
  help, --help                       Show this help

TILE CREATE OPTIONS
  <type>          Tile type: term, note, code, image, graph
  --file <path>   File to open in the tile
  --pos x,y       Position in grid units (default: auto)
  --size w,h      Size in grid units (default: type-dependent)

TILE MOVE OPTIONS
  --pos x,y       New position in grid units

TILE RESIZE OPTIONS
  --size w,h      New size in grid units

TERMINAL READ OPTIONS
  --lines N       Number of lines to capture (default: 50)

COORDINATES
  All coordinates are in grid units.
  One grid unit = 20 pixels on the canvas.

EXIT CODES
  0   Success
  1   RPC error
  2   Connection failure

VERSION
  collab v${VERSION}`);
  process.exit(0);
}

// --- main dispatch --------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.length === 0) usage();

try {
  const cmd = argv[0];
  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    case "--version":
    case "-v":
      console.log(`collab v${VERSION}`);
      break;
    case "tile": {
      if (argv.length < 2) {
        die("tile requires a subcommand (list, create, rm, move, resize, focus)");
      }
      const sub = argv[1];
      const rest = argv.slice(2);
      switch (sub) {
        case "list":   await cmdTileList(); break;
        case "create": await cmdTileCreate(rest); break;
        case "rm":     await cmdTileRm(rest); break;
        case "move":   await cmdTileMove(rest); break;
        case "resize": await cmdTileResize(rest); break;
        case "focus":  await cmdTileFocus(rest); break;
        default: die(`unknown tile subcommand: ${sub}`);
      }
      break;
    }
    case "terminal": {
      if (argv.length < 2) {
        die("terminal requires a subcommand (write, read)");
      }
      const sub = argv[1];
      const rest = argv.slice(2);
      switch (sub) {
        case "write": await cmdTerminalWrite(rest); break;
        case "read":  await cmdTerminalRead(rest); break;
        default: die(`unknown terminal subcommand: ${sub}`);
      }
      break;
    }
    default:
      die(`unknown command: ${cmd} (try: collab --help)`);
  }
} catch (err) {
  die(err.message);
}
