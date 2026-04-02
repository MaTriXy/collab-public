#!/usr/bin/env bash
set -euo pipefail

# Integration tests for collab CLI canvas commands.
# Requires: Collaborator app running, node installed, jq installed.
# Runs against the repo copy of collab-cli.mjs, not the installed one.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cli() { node "$SCRIPT_DIR/collab-cli.mjs" "$@"; }

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass=0
fail=0
skip=0

ok() {
  printf "${GREEN}PASS${NC} %s\n" "$1"
  pass=$((pass + 1))
}

fail() {
  printf "${RED}FAIL${NC} %s: %s\n" "$1" "$2"
  fail=$((fail + 1))
}

skipped() {
  printf "${YELLOW}SKIP${NC} %s: %s\n" "$1" "$2"
  skip=$((skip + 1))
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    ok "$label"
  else
    fail "$label" "expected '$expected', got '$actual'"
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    ok "$label"
  else
    fail "$label" "expected output to contain '$needle', got '$haystack'"
  fi
}

# ---- preflight ------------------------------------------------------------

command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required"; exit 1; }

if ! cli --version >/dev/null 2>&1; then
  echo "Cannot run CLI"
  exit 2
fi

echo "=== collab CLI integration tests ==="
echo ""

# ---- tile create ----------------------------------------------------------

echo "--- tile create ---"
tile_id=$(cli tile create note --pos 10,15 --size 22,27 2>/dev/null) \
  && create_ok=true || create_ok=false

if $create_ok && [[ -n "$tile_id" ]]; then
  ok "tile create succeeds"
  ok "tile create returns tileId ($tile_id)"
else
  fail "tile create" "command failed or returned empty"
  tile_id=""
fi
echo ""

# ---- tile list ------------------------------------------------------------

echo "--- tile list ---"
list_out=$(cli tile list 2>/dev/null) && list_ok=true || list_ok=false
if $list_ok; then
  ok "tile list succeeds"
else
  fail "tile list" "command failed"
fi

if [[ -n "$tile_id" ]]; then
  tile_json=$(printf '%s' "$list_out" \
    | jq -c ".tiles[] | select(.id == \"$tile_id\")")
  if [[ -n "$tile_json" ]]; then
    ok "created tile found in list"
    t_px=$(printf '%s' "$tile_json" | jq '.position.x')
    t_py=$(printf '%s' "$tile_json" | jq '.position.y')
    t_sw=$(printf '%s' "$tile_json" | jq '.size.width')
    t_sh=$(printf '%s' "$tile_json" | jq '.size.height')
    assert_eq "tile position.x is 10" "10" "$t_px"
    assert_eq "tile position.y is 15" "15" "$t_py"
    assert_eq "tile size.width is 22" "22" "$t_sw"
    assert_eq "tile size.height is 27" "27" "$t_sh"
  else
    fail "created tile found in list" "tile $tile_id not in response"
  fi
else
  skipped "tile list verification" "no tile_id from create"
fi
echo ""

# ---- tile move ------------------------------------------------------------

echo "--- tile move ---"
if [[ -n "$tile_id" ]]; then
  mv_out=$(cli tile move "$tile_id" --pos 25,30 2>/dev/null) \
    && mv_ok=true || mv_ok=false
  if $mv_ok; then
    ok "tile move succeeds"
    assert_contains "tile move confirms" "moved $tile_id" "$mv_out"
  else
    fail "tile move" "command failed"
  fi

  list2_out=$(cli tile list 2>/dev/null) && true
  t2_json=$(printf '%s' "$list2_out" \
    | jq -c ".tiles[] | select(.id == \"$tile_id\")")
  t2_px=$(printf '%s' "$t2_json" | jq '.position.x')
  t2_py=$(printf '%s' "$t2_json" | jq '.position.y')
  assert_eq "moved tile position.x is 25" "25" "$t2_px"
  assert_eq "moved tile position.y is 30" "30" "$t2_py"
else
  skipped "tile move" "no tile_id"
fi
echo ""

# ---- tile resize ----------------------------------------------------------

echo "--- tile resize ---"
if [[ -n "$tile_id" ]]; then
  rs_out=$(cli tile resize "$tile_id" --size 40,35 2>/dev/null) \
    && rs_ok=true || rs_ok=false
  if $rs_ok; then
    ok "tile resize succeeds"
    assert_contains "tile resize confirms" "resized $tile_id" "$rs_out"
  else
    fail "tile resize" "command failed"
  fi

  list3_out=$(cli tile list 2>/dev/null) && true
  t3_json=$(printf '%s' "$list3_out" \
    | jq -c ".tiles[] | select(.id == \"$tile_id\")")
  t3_sw=$(printf '%s' "$t3_json" | jq '.size.width')
  t3_sh=$(printf '%s' "$t3_json" | jq '.size.height')
  assert_eq "resized tile width is 40" "40" "$t3_sw"
  assert_eq "resized tile height is 35" "35" "$t3_sh"
else
  skipped "tile resize" "no tile_id"
fi
echo ""

# ---- tile focus -----------------------------------------------------------

echo "--- tile focus ---"
if [[ -n "$tile_id" ]]; then
  focus_out=$(cli tile focus "$tile_id" 2>/dev/null) \
    && focus_ok=true || focus_ok=false
  if $focus_ok; then
    ok "tile focus succeeds"
    assert_contains "tile focus confirms" "focused $tile_id" "$focus_out"
  else
    fail "tile focus" "command failed"
  fi
else
  skipped "tile focus" "no tile_id"
fi
echo ""

# ---- tile rm --------------------------------------------------------------

echo "--- tile rm ---"
if [[ -n "$tile_id" ]]; then
  rm_out=$(cli tile rm "$tile_id" 2>/dev/null) \
    && rm_ok=true || rm_ok=false
  if $rm_ok; then
    ok "tile rm succeeds"
    assert_contains "tile rm confirms" "removed $tile_id" "$rm_out"
  else
    fail "tile rm" "command failed"
  fi

  list4_out=$(cli tile list 2>/dev/null) && true
  t4_json=$(printf '%s' "$list4_out" \
    | jq -c ".tiles[] | select(.id == \"$tile_id\")" 2>/dev/null)
  if [[ -z "$t4_json" ]]; then
    ok "removed tile no longer in list"
  else
    fail "removed tile no longer in list" "tile $tile_id still present"
  fi
else
  skipped "tile rm" "no tile_id"
fi
echo ""

# ---- error handling -------------------------------------------------------

echo "--- error handling ---"
err_out=$(cli tile rm nonexistent-tile 2>&1) && err_ok=true || err_ok=false
if ! $err_ok; then
  ok "tile rm nonexistent fails with non-zero exit"
  assert_contains "error message present" "error:" "$err_out"
else
  fail "tile rm nonexistent" "should have failed"
fi
echo ""

# ---- summary --------------------------------------------------------------

echo "==========================="
printf "${GREEN}%d passed${NC}" "$pass"
[[ $fail -gt 0 ]] && printf ", ${RED}%d failed${NC}" "$fail"
[[ $skip -gt 0 ]] && printf ", ${YELLOW}%d skipped${NC}" "$skip"
echo ""
[[ $fail -eq 0 ]] && exit 0 || exit 1
