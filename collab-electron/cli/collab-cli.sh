#!/usr/bin/env bash
set -euo pipefail

VERSION="0.1.0"
GRID_UNIT=20
SOCKET_PATH_FILE="$HOME/.collaborator/socket-path"

# --- helpers ---------------------------------------------------------------

die() { echo "error: $1" >&2; exit "${2:-1}"; }

read_socket_path() {
  [[ -f "$SOCKET_PATH_FILE" ]] ||
    die "collaborator is not running (no socket-path file)" 2
  local sock
  sock="$(cat "$SOCKET_PATH_FILE")"
  [[ -S "$sock" ]] ||
    die "collaborator is not running (socket missing)" 2
  echo "$sock"
}

# Send a JSON-RPC request and print just the result on stdout.
# Exits non-zero with an error message on RPC errors.
rpc_call() {
  local method="$1" params="${2:-\{\}}"
  local sock
  sock="$(read_socket_path)" || exit $?

  perl -MIO::Socket::UNIX -MJSON::PP -e '
    my ($path, $method, $raw) = @ARGV;
    my $pp = JSON::PP->new->utf8;
    my $req = $pp->encode({
      jsonrpc => "2.0", id => 1,
      method  => $method,
      params  => $pp->decode($raw),
    });

    my $sock = IO::Socket::UNIX->new(
      Peer => $path, Type => IO::Socket::UNIX::SOCK_STREAM,
    ) or die "error: connect: $!\n";
    $sock->print("$req\n");
    $sock->flush;

    local $SIG{ALRM} = sub { die "error: timeout\n" };
    alarm 10;
    my $line = <$sock>;
    alarm 0;
    $sock->close;

    die "error: no response from collaborator\n" unless defined $line;
    chomp $line;

    my $resp = $pp->decode($line);
    if (my $e = $resp->{error}) {
      print STDERR "error: " . ($e->{message} // "unknown") . "\n";
      exit 1;
    }

    my $r = $resp->{result};
    if (ref $r) {
      print $pp->encode($r);
    } elsif (defined $r) {
      print "$r\n";
    }
  ' "$sock" "$method" "$params" || exit $?
}

json_pretty() {
  perl -MJSON::PP -e '
    local $/;
    print JSON::PP->new->pretty->canonical->encode(
      JSON::PP->new->decode(<STDIN>)
    );
  '
}

tiles_to_grid() {
  perl -MJSON::PP -e '
    my $gu = shift;
    local $/;
    my $data = JSON::PP->new->decode(<STDIN>);
    for my $t (@{$data->{tiles} // []}) {
      if (my $p = $t->{position}) {
        $p->{x}     = int($p->{x}     / $gu);
        $p->{y}     = int($p->{y}     / $gu);
      }
      if (my $s = $t->{size}) {
        $s->{width}  = int($s->{width}  / $gu);
        $s->{height} = int($s->{height} / $gu);
      }
    }
    print JSON::PP->new->pretty->canonical->encode($data);
  ' "$GRID_UNIT"
}

grid_to_px() { echo $(( $1 * GRID_UNIT )); }

parse_pos() {
  local pos="$1" x="${1%%,*}" y="${1##*,}"
  [[ "$x" =~ ^[0-9]+$ && "$y" =~ ^[0-9]+$ ]] || die "invalid position: $pos"
  echo "$x $y"
}

parse_size() {
  local size="$1" w="${1%%,*}" h="${1##*,}"
  [[ "$w" =~ ^[0-9]+$ && "$h" =~ ^[0-9]+$ ]] || die "invalid size: $size"
  echo "$w $h"
}

# --- usage -----------------------------------------------------------------

usage() {
  cat <<HELP
collab — control the Collaborator canvas from the command line

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
  collab v$VERSION
HELP
  exit 0
}

# --- subcommands -----------------------------------------------------------

cmd_tile_list() {
  rpc_call "canvas.tileList" "{}" | tiles_to_grid
}

cmd_tile_create() {
  local tile_type="" file="" pos_x="" pos_y="" size_w="" size_h=""

  [[ $# -ge 1 ]] || die "tile create requires a type (term, note, code, image, graph)"
  tile_type="$1"; shift

  case "$tile_type" in
    term|note|code|image|graph) ;;
    *) die "unknown tile type: $tile_type (expected: term, note, code, image, graph)" ;;
  esac

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --file)
        [[ $# -ge 2 ]] || die "--file requires a path"
        file="$2"; shift 2
        ;;
      --pos)
        [[ $# -ge 2 ]] || die "--pos requires x,y"
        local coords
        coords="$(parse_pos "$2")"
        pos_x="${coords%% *}"
        pos_y="${coords##* }"
        shift 2
        ;;
      --size)
        [[ $# -ge 2 ]] || die "--size requires w,h"
        local dims
        dims="$(parse_size "$2")"
        size_w="${dims%% *}"
        size_h="${dims##* }"
        shift 2
        ;;
      *) die "unknown option: $1" ;;
    esac
  done

  local params="{\"tileType\":\"$tile_type\""

  if [[ -n "$pos_x" ]]; then
    local px_x px_y
    px_x="$(grid_to_px "$pos_x")"
    px_y="$(grid_to_px "$pos_y")"
    params="$params,\"position\":{\"x\":$px_x,\"y\":$px_y}"
  fi

  if [[ -n "$file" ]]; then
    local abs_file
    abs_file="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
    params="$params,\"filePath\":\"$abs_file\""
  fi

  if [[ -n "$size_w" ]]; then
    local px_w px_h
    px_w="$(grid_to_px "$size_w")"
    px_h="$(grid_to_px "$size_h")"
    params="$params,\"size\":{\"width\":$px_w,\"height\":$px_h}"
  fi

  params="$params}"

  local result
  result="$(rpc_call "canvas.tileCreate" "$params")"
  echo "$result" |
    perl -MJSON::PP -e 'local $/; my $d = JSON::PP->new->decode(<STDIN>);
      print $d->{tileId} . "\n" if $d->{tileId};'
}

cmd_tile_rm() {
  [[ $# -ge 1 ]] || die "tile rm requires a tile id"
  local tile_id="$1"
  rpc_call "canvas.tileRemove" "{\"tileId\":\"$tile_id\"}" > /dev/null
  echo "removed $tile_id"
}

cmd_tile_move() {
  local tile_id="" pos_x="" pos_y=""

  [[ $# -ge 1 ]] || die "tile move requires a tile id"
  tile_id="$1"; shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pos)
        [[ $# -ge 2 ]] || die "--pos requires x,y"
        local coords
        coords="$(parse_pos "$2")"
        pos_x="${coords%% *}"
        pos_y="${coords##* }"
        shift 2
        ;;
      *) die "unknown option: $1" ;;
    esac
  done

  [[ -n "$pos_x" ]] || die "tile move requires --pos x,y"

  local px_x px_y
  px_x="$(grid_to_px "$pos_x")"
  px_y="$(grid_to_px "$pos_y")"

  rpc_call "canvas.tileMove" \
    "{\"tileId\":\"$tile_id\",\"position\":{\"x\":$px_x,\"y\":$px_y}}" > /dev/null
  echo "moved $tile_id to $pos_x,$pos_y"
}

cmd_tile_resize() {
  local tile_id="" size_w="" size_h=""

  [[ $# -ge 1 ]] || die "tile resize requires a tile id"
  tile_id="$1"; shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --size)
        [[ $# -ge 2 ]] || die "--size requires w,h"
        local dims
        dims="$(parse_size "$2")"
        size_w="${dims%% *}"
        size_h="${dims##* }"
        shift 2
        ;;
      *) die "unknown option: $1" ;;
    esac
  done

  [[ -n "$size_w" ]] || die "tile resize requires --size w,h"

  local px_w px_h
  px_w="$(grid_to_px "$size_w")"
  px_h="$(grid_to_px "$size_h")"

  rpc_call "canvas.tileResize" \
    "{\"tileId\":\"$tile_id\",\"size\":{\"width\":$px_w,\"height\":$px_h}}" > /dev/null
  echo "resized $tile_id to $size_w,$size_h"
}

cmd_tile_focus() {
  [[ $# -ge 1 ]] || die "tile focus requires at least one tile id"
  local ids=""
  for id in "$@"; do
    [[ -z "$ids" ]] && ids="\"$id\"" || ids="$ids,\"$id\""
  done
  rpc_call "canvas.tileFocus" "{\"tileIds\":[$ids]}" > /dev/null
  echo "focused $*"
}

cmd_terminal_write() {
  [[ $# -ge 2 ]] || die "terminal write requires <id> <input>"
  local tile_id="$1" input="$2"
  input="${input//\\/\\\\}"
  input="${input//\"/\\\"}"
  input="${input//$'\n'/\\n}"
  input="${input//$'\r'/\\r}"
  input="${input//$'\t'/\\t}"
  rpc_call "canvas.terminalWrite" \
    "{\"tileId\":\"$tile_id\",\"input\":\"$input\"}" > /dev/null
  echo "wrote to $tile_id"
}

cmd_terminal_read() {
  local tile_id="" lines=50

  [[ $# -ge 1 ]] || die "terminal read requires a tile id"
  tile_id="$1"; shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --lines)
        [[ $# -ge 2 ]] || die "--lines requires a number"
        lines="$2"; shift 2
        ;;
      *) die "unknown option: $1" ;;
    esac
  done

  rpc_call "canvas.terminalRead" \
    "{\"tileId\":\"$tile_id\",\"lines\":$lines}" | json_pretty
}

# --- main dispatch ---------------------------------------------------------

[[ $# -ge 1 ]] || usage

case "$1" in
  help|--help|-h)
    usage
    ;;
  --version|-v)
    echo "collab v$VERSION"
    exit 0
    ;;
  tile)
    [[ $# -ge 2 ]] || die "tile requires a subcommand (list, create, rm, move, resize, focus)"
    subcmd="$2"; shift 2
    case "$subcmd" in
      list)   cmd_tile_list "$@" ;;
      create) cmd_tile_create "$@" ;;
      rm)     cmd_tile_rm "$@" ;;
      move)   cmd_tile_move "$@" ;;
      resize) cmd_tile_resize "$@" ;;
      focus)  cmd_tile_focus "$@" ;;
      *)      die "unknown tile subcommand: $subcmd" ;;
    esac
    ;;
  terminal)
    [[ $# -ge 2 ]] || die "terminal requires a subcommand (write, read)"
    subcmd="$2"; shift 2
    case "$subcmd" in
      write) cmd_terminal_write "$@" ;;
      read)  cmd_terminal_read "$@" ;;
      *)     die "unknown terminal subcommand: $subcmd" ;;
    esac
    ;;
  *)
    die "unknown command: $1 (try: collab --help)"
    ;;
esac
