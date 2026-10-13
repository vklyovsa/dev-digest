#!/usr/bin/env bash
# PreToolUse(Bash) gate: refuses a `git commit` in command position until every touched
# package (server, client, reviewer-core, mcp) is named green by a fresh stamp — the record
# commit-check.sh writes for exactly the file content in the working copy. It only compares:
# no test, typecheck or install runs here.
#
#   commit-gate.sh                  # hook mode: reads the hook payload on stdin
#   commit-gate.sh --check "<cmd>"  # same decision, command passed as an argument, stdin unread
#
# COMMIT_GATE_OVERRIDE=1 in the hook's environment, or as an assignment before the commit
# command itself, bypasses the gate. It is for an explicit instruction of the developer only.
#
# exit 0 = allow, exit 2 = refuse (stderr is fed back to Claude). Claude Code lets a call run
# on exit 1, so every other code is turned into 2.
set -uo pipefail
trap 'rc=$?; [[ $rc == 0 || $rc == 2 ]] || { echo "commit-gate: internal failure (exit $rc), failing closed" >&2; exit 2; }' EXIT

refuse() {
  printf 'commit-gate: %s\n' "$@" >&2
  exit 2
}

HERE="${BASH_SOURCE[0]%/*}"
[[ "$HERE" == "${BASH_SOURCE[0]}" ]] && HERE=.

if [[ -z "${CLAUDE_PROJECT_DIR:-}" ]]; then
  CLAUDE_PROJECT_DIR="$(cd "$HERE/../../.." 2>/dev/null && pwd -P)" \
    || refuse "the project directory cannot be resolved from $HERE, failing closed."
fi
[[ -d "$CLAUDE_PROJECT_DIR" ]] || refuse "the project directory $CLAUDE_PROJECT_DIR does not exist, failing closed."
export CLAUDE_PROJECT_DIR

# shellcheck source=guard-lib.sh
source "$HERE/guard-lib.sh" || refuse "guard-lib.sh could not be loaded, failing closed."
[[ -n "${ROOT:-}" && -d "$ROOT" ]] || refuse "the project directory $CLAUDE_PROJECT_DIR cannot be entered, failing closed."
# shellcheck source=commit-gate-lib.sh
source "$HERE/commit-gate-lib.sh" || refuse "commit-gate-lib.sh could not be loaded, failing closed."

command -v jq >/dev/null 2>&1 || command -v node >/dev/null 2>&1 \
  || refuse "neither jq nor node is on PATH, so the hook payload and the stamp cannot be read; failing closed."

payload_field() {
  if command -v jq >/dev/null 2>&1; then
    jq -rs --arg field "$1" '
      if length == 1 and (.[0] | type) == "object" then .[0] else error("not one object") end
      | if $field == "tool" then .tool_name
        else (.tool_input | if type == "object" then .command else null end) end
      | if type == "string" then . else "" end' <<<"$PAYLOAD" 2>/dev/null
  else
    node -e '
      let text = "";
      process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
        const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
        let payload;
        try { payload = JSON.parse(text); } catch { process.exit(1); }
        if (!isObject(payload)) process.exit(1);
        const value = process.argv[1] === "tool" ? payload.tool_name
          : isObject(payload.tool_input) ? payload.tool_input.command : null;
        if (typeof value === "string") process.stdout.write(value);
      });' "$1" <<<"$PAYLOAD" 2>/dev/null
  fi
}

if [[ "${1:-}" == "--check" ]]; then
  CMD="${2:-}"
else
  PAYLOAD="$(cat 2>/dev/null)" || refuse "the hook payload could not be read, failing closed."
  TOOL="$(payload_field tool)" || refuse "the hook payload is not one JSON object, failing closed."
  [[ "$TOOL" == "Bash" ]] || exit 0
  CMD="$(payload_field command)" || refuse "the hook payload is not one JSON object, failing closed."
fi

[[ -z "$CMD" ]] && exit 0

STRIPPED="$(lib_strip_quotes "$CMD" 2>/dev/null)" \
  || refuse "the command text could not be scanned (awk failed), failing closed."
SEGMENTS="$(segments "$STRIPPED" 2>/dev/null)" \
  || refuse "the command text could not be split (sed failed), failing closed."

COMMIT_RE="${GIT}commit([[:space:]]|\$)"
OVERRIDE_RE='[[:space:]]COMMIT_GATE_OVERRIDE=1[[:space:]]'
commits=0
overridden=0
while IFS= read -r seg; do
  [[ "$seg" == *commit* ]] || continue
  n="$(normalize "$seg" 2>/dev/null)" || refuse "a command segment could not be read, failing closed."
  [[ "$n" =~ $COMMIT_RE ]] || continue
  commits=$((commits + 1))
  prefix="${seg%"$n"}"
  [[ " $prefix " =~ $OVERRIDE_RE ]] && overridden=$((overridden + 1))
done <<<"$SEGMENTS"

[[ "$commits" == 0 ]] && exit 0

if [[ "${COMMIT_GATE_OVERRIDE:-}" == "1" ]]; then
  echo "commit-gate: bypassed by COMMIT_GATE_OVERRIDE=1 (environment)" >&2
  exit 0
fi
if [[ "$overridden" == "$commits" ]]; then
  echo "commit-gate: bypassed by COMMIT_GATE_OVERRIDE=1 (command)" >&2
  exit 0
fi

TOUCHED="$(cg_touched_packages)" || refuse "git could not read the state of $ROOT, failing closed."
[[ -z "$TOUCHED" ]] && exit 0

ROWS=""
STAMP_REASON=""
if [[ ! -f "$CG_STAMP" ]]; then
  STAMP_REASON="no stamp (the test check has not run in this working copy)"
elif ! ROWS="$(cg_stamp_rows)"; then
  STAMP_REASON="no readable stamp (${CG_STAMP#"$ROOT"/} is not the record the test check writes)"
fi

missing=()
lines=()
while IFS= read -r pkg; do
  reason="$STAMP_REASON"
  if [[ -z "$reason" ]]; then
    green=""
    recorded=""
    while IFS=$'\t' read -r name value fingerprint; do
      [[ "$name" == "$pkg" ]] && { green="$value"; recorded="$fingerprint"; }
    done <<<"$ROWS"
    if [[ "$green" != "true" ]]; then
      reason="not named green by the stamp"
    else
      current="$(cg_fingerprint "$pkg")" || refuse "git could not hash the files under $pkg/, failing closed."
      [[ -n "$current" && "$recorded" == "$current" ]] \
        || reason="stale stamp (a file under $pkg/ changed after its green check)"
    fi
  fi
  if [[ -n "$reason" ]]; then
    missing+=("$pkg")
    lines+=("  $pkg: $reason")
  fi
done <<<"$TOUCHED"

if [[ ${#missing[@]} -gt 0 ]]; then
  refuse "commit refused — the touched packages are not proven green for the content in the working copy." \
    "${lines[@]}" \
    "Run \`.claude/agents/scripts/commit-check.sh ${missing[*]}\` as its own Bash call, then retry the commit." \
    "COMMIT_GATE_OVERRIDE=1 before the commit command bypasses this gate: it is for an explicit instruction of the developer only."
fi

exit 0
