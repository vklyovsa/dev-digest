#!/usr/bin/env bash
# Runs the static checks and the tests of one or more packages and prints one line per step,
# so a verification costs an agent one turn and a summary instead of four turns and a log.
#
#   check-code.sh [--it] [--no-tests] <package>… [-- <vitest filter>…]
#
#   package       server | client | reviewer-core | mcp
#   --it          server: run the *.it.test.ts lane after the unit lane (needs Docker; the
#                 files self-skip without it, and a lane where nothing ran is reported SKIP)
#   --no-tests    static checks only
#   -- <filter>…  one package only: run just the test files matching these `vitest run`
#                 filters (paths relative to the package, or repo-relative) instead of a lane
#
# Steps — server: typecheck, depcruise, tests · client: typecheck, tests ·
# reviewer-core: typecheck, the server typecheck (it compiles reviewer-core/src), tests ·
# mcp: typecheck, depcruise, tests.
# Tools are called from node_modules/.bin, never through pnpm or npm: server/package.json is
# skip-worktree, pnpm inside mcp/ reinstalls it, and pnpm can exit non-zero after a clean run
# (INSIGHTS.md § Tool & Library Notes, § Recurring Errors & Fixes).
# A failed step is followed by an excerpt of its output; every full log is kept in the
# directory named on the last line, outside the repository.
# Exit 0 every step passed · 1 a step failed · 3 cannot run · 64 usage.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[[ -n "$ROOT" && -d "$ROOT" ]] || { echo "check-code.sh: not inside the repository" >&2; exit 3; }

usage() {
  echo "usage: check-code.sh [--it] [--no-tests] <server|client|reviewer-core|mcp>… [-- <vitest filter>…]" >&2
  exit 64
}

WITH_IT=0
NO_TESTS=0
PACKAGES=()
FILTERS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --it) WITH_IT=1; shift ;;
    --no-tests) NO_TESTS=1; shift ;;
    --) shift; FILTERS=("$@"); break ;;
    server|client|reviewer-core|mcp) PACKAGES+=("$1"); shift ;;
    *) echo "check-code.sh: unknown argument $1" >&2; usage ;;
  esac
done

[[ ${#PACKAGES[@]} -gt 0 ]] || usage
if [[ ${#FILTERS[@]} -gt 0 && ${#PACKAGES[@]} -ne 1 ]]; then
  echo "check-code.sh: test filters need exactly one package" >&2
  exit 64
fi

LOGS="$(mktemp -d "${TMPDIR:-/tmp}/check-code.XXXXXX")" || { echo "check-code.sh: no temp directory" >&2; exit 3; }
FAILED=0

excerpt() {
  local log="$1" from="$2" max="$3"
  if grep -Eq "$from" "$log"; then
    awk -v re="$from" -v max="$max" '!on && $0 ~ re { on = 1 } on && n < max { print "      " $0; n++ }' "$log"
  else
    tail -n "$max" "$log" | sed 's/^/      /'
  fi
}

summary() {
  local kind="$1" log="$2" rc="$3" line
  case "$kind" in
    typecheck)
      if [[ "$rc" == 0 ]]; then echo "no errors"; else echo "$(grep -c 'error TS' "$log") errors"; fi ;;
    arch)
      line="$(grep -E 'dependency violations' "$log" | tail -n 1 | sed -E 's/^[^[:alnum:]]+//')"
      echo "${line:-exit $rc}" ;;
    tests)
      line="$(grep -E '^[[:space:]]*(Test Files|Tests)[[:space:]]' "$log" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+/ /g' | paste -sd '|' | sed 's/|/ · /g')"
      echo "${line:-exit $rc}" ;;
  esac
}

run_step() {
  local label="$1" dir="$2" kind="$3"
  shift 3
  local log="$LOGS/${label// /-}.log" start=$SECONDS rc status text
  if [[ ! -x "$ROOT/$dir/$1" ]]; then
    echo "FAIL  $label — $dir/$1 is missing: install the dependencies of $dir first"
    FAILED=1
    return
  fi
  (cd "$ROOT/$dir" && NO_COLOR=1 FORCE_COLOR=0 "$@") >"$log" 2>&1
  rc=$?
  text="$(summary "$kind" "$log" "$rc")"
  status="ok  "
  if [[ "$rc" != 0 ]]; then
    status="FAIL"
    FAILED=1
  elif [[ "$kind" == tests ]] && ! grep -Eq '^[[:space:]]*Tests[[:space:]].*[0-9]+ passed' "$log"; then
    status="SKIP"
    text="$text — no test executed, so this proves nothing"
  fi
  echo "$status  $label — $text ($((SECONDS - start))s)"
  [[ "$rc" == 0 ]] && return
  case "$kind" in
    typecheck) excerpt "$log" 'error TS' 40 ;;
    arch) excerpt "$log" '(error|warn) ' 40 ;;
    tests) excerpt "$log" '(Failed (Tests|Suites)|^[[:space:]]*(FAIL|×) |Error:)' 80 ;;
  esac
}

TSC=node_modules/.bin/tsc
VITEST=node_modules/.bin/vitest
DEPCRUISE=node_modules/.bin/depcruise

run_tests() {
  local pkg="$1"
  [[ "$NO_TESTS" == 1 ]] && return
  if [[ ${#FILTERS[@]} -gt 0 ]]; then
    run_step "$pkg tests (filtered)" "$pkg" tests "$VITEST" run "${FILTERS[@]#"$pkg"/}"
    return
  fi
  if [[ "$pkg" == server ]]; then
    run_step "server unit tests" server tests "$VITEST" run --exclude '**/*.it.test.ts'
    [[ "$WITH_IT" == 1 ]] && run_step "server integration tests" server tests "$VITEST" run .it.test
    return
  fi
  run_step "$pkg tests" "$pkg" tests "$VITEST" run --passWithNoTests
}

for pkg in "${PACKAGES[@]}"; do
  case "$pkg" in
    server)
      run_step "server typecheck" server typecheck "$TSC" --noEmit -p tsconfig.json
      run_step "server depcruise" server arch "$DEPCRUISE" src --config .dependency-cruiser.cjs
      ;;
    client)
      run_step "client typecheck" client typecheck "$TSC" --noEmit
      ;;
    reviewer-core)
      run_step "reviewer-core typecheck" reviewer-core typecheck "$TSC" --noEmit -p tsconfig.json
      run_step "server typecheck (compiles reviewer-core)" server typecheck "$TSC" --noEmit -p tsconfig.json
      ;;
    mcp)
      run_step "mcp typecheck" mcp typecheck "$TSC" --noEmit -p tsconfig.json
      run_step "mcp depcruise" mcp arch "$DEPCRUISE" src --config .dependency-cruiser.cjs
      ;;
  esac
  run_tests "$pkg"
done

echo "logs: $LOGS"
exit "$FAILED"
