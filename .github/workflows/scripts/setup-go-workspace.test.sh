#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/setup-go-workspace.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bifrost-workspace-test.XXXXXX")"
trap 'rm -r "$TEST_ROOT"' EXIT
export GOWORK="$TEST_ROOT/go.work"

write_module() {
  mkdir -p "$TEST_ROOT/$1"
  printf 'module example.com/%s\n\ngo %s\n' "$2" "$3" > "$TEST_ROOT/$1/go.mod"
}

existing_workspace() {
  write_module core core 1.22.5
  write_module local-extra local-extra 1.20
  printf 'go 1.20\n\nuse (\n\t./core\n\t./local-extra\n)\n' > "$TEST_ROOT/go.work"
}

assert_existing_members() {
  local modules
  modules="$(go list -m)"
  if [ "$modules" != "$(printf 'example.com/core\nexample.com/local-extra')" ]; then
    echo "FAIL: existing workspace members changed: $modules" >&2
    return 1
  fi
}

refresh_sourced_workspace() {
  existing_workspace
  cd "$TEST_ROOT"
  bash -c 'source "$1"; go list -m' _ "$TARGET"
  assert_existing_members
}

refresh_executed_workspace() {
  existing_workspace
  cd "$TEST_ROOT"
  bash "$TARGET"
  assert_existing_members
}

initialize_workspace() {
  local module
  if [ -e "$GOWORK" ]; then
    echo "FAIL: initialization must start without a workspace" >&2
    return 1
  fi
  for module in core framework transports cli plugins/custom tests/cmd/seed; do
    write_module "$module" "${module//\//-}" 1.22.5
  done
  cd "$TEST_ROOT"
  bash "$TARGET"
  if [ "$(go list -m | wc -l | tr -d ' ')" != "6" ]; then
    echo "FAIL: initialized workspace is missing a module" >&2
    return 1
  fi
  go list -m example.com/plugins-custom example.com/tests-cmd-seed
}

reject_invalid_workspace() {
  printf 'go 1.20\n\nuse ./missing\n' > "$TEST_ROOT/go.work"
  cd "$TEST_ROOT"
  if bash -c 'source "$1"' _ "$TARGET"; then
    echo "FAIL: accepted a workspace with a missing module" >&2
    return 1
  fi
}

if [ "${1:-}" = "--case" ]; then
  "$2"
  exit
fi

passed=0
failed=0
for scenario in refresh_sourced_workspace refresh_executed_workspace initialize_workspace reject_invalid_workspace; do
  if bash "${BASH_SOURCE[0]}" --case "$scenario" > "$TEST_ROOT/$scenario.log" 2>&1; then
    echo "  ok - $scenario"
    passed=$((passed + 1))
  else
    echo "  FAIL - $scenario"
    cat "$TEST_ROOT/$scenario.log"
    failed=$((failed + 1))
  fi
done
echo "setup-go-workspace: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
