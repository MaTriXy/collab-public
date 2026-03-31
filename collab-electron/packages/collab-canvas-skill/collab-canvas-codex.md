# Collaborator Canvas — Codex CLI Instructions

You have access to the `collab` CLI for controlling Collaborator's spatial canvas.
The canvas is a pannable, zoomable surface where tiles display terminals, files, images, and graphs.

## Coordinate System

All positions and sizes use **grid units** (1 unit = 20px).
Origin (0,0) is top-left. X increases rightward, Y downward.

## Tile Types and Default Sizes

| Type    | Default size (w x h) | Use for                          |
|---------|-----------------------|----------------------------------|
| `term`  | 20 x 25              | Terminal / shell session         |
| `note`  | 22 x 27              | Markdown files (.md, .txt)       |
| `code`  | 22 x 27              | Source code files                |
| `image` | 14 x 14              | Images (.png, .jpg, .gif, .webp) |
| `graph` | 30 x 25              | .graph.json or folder graphs     |

Type is inferred from file extension when `--file` is used.

## Commands

```bash
# List all tiles
collab tile list

# Add a tile (returns tile ID)
collab tile create <type> [--file <path>] [--pos x,y] [--size w,h]

# Remove a tile
collab tile rm <id>

# Move a tile
collab tile move <id> --pos x,y

# Resize a tile
collab tile resize <id> --size w,h

# Get viewport state
collab viewport

# Set viewport pan/zoom
collab viewport set [--pan x,y] [--zoom level]
```

## Examples

```bash
# Side-by-side code comparison
collab tile create code --file ./old.ts --pos 0,0
collab tile create code --file ./new.ts --pos 23,0

# Research workspace: graph left, notes right, terminal below
collab tile create graph --file ./research.graph.json --pos 0,0 --size 30,25
collab tile create note --file ./notes.md --pos 31,0
collab tile create term --pos 0,26

# Frame the viewport after arranging
collab viewport set --pan 0,0 --zoom 0.8
```

## Conventions

1. Always `collab tile list` first to see existing tiles before creating new ones.
2. Use `collab viewport set` to frame the view after arranging tiles.
3. Remove tiles when no longer needed with `collab tile rm`.
4. Leave 1 grid unit gap between adjacent tiles.
5. File tiles auto-refresh when you write to the underlying file.
6. Graph tiles support incremental updates — append nodes to `.graph.json` and the graph updates smoothly.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | RPC error |
| 2 | Connection failure (Collaborator not running) |
