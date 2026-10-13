#!/usr/bin/env bash
# The test check behind commit-gate.sh: runs check-code.sh for the touched packages and
# records which of them ended green, for exactly the file content that was checked.
#
#   commit-check.sh [<package>…]
#
#   package   server | client | reviewer-core | mcp; without one, every package that has an
#             uncommitted change under its folder
#
# One `check-code.sh <package>` call per package, without --it; its output is printed as it
# comes. A package is green when the call exits 0, prints at least one `ok` step and no `FAIL`
# or `SKIP` step, and no file under the package changed while it ran. The record is
# .claude/commit-gate/last-green.json (git-ignored); entries of packages not checked now stay.
# Exit 0 every checked package green · 1 at least one not green · 3 cannot run · 64 usage.
set -uo pipefail

HERE="${BASH_SOURCE[0]%/*}"
[[ "$HERE" == "${BASH_SOURCE[0]}" ]] && HERE=.

ROOT="${CLAUDE_PROJECT_DIR:-$HERE/../../..}"
ROOT="$(cd "$ROOT" 2>/dev/null && pwd -P)" || { echo "commit-check: no project directory" >&2; exit 3; }
export CLAUDE_PROJECT_DIR="$ROOT"

# shellcheck source=commit-gate-lib.sh
source "$HERE/commit-gate-lib.sh" || exit 3

PACKAGES=()
for arg in "$@"; do
  known=0
  for pkg in "${CG_PACKAGES[@]}"; do
    [[ "$arg" == "$pkg" ]] && known=1
  done
  if [[ "$known" == 0 ]]; then
    echo "commit-check: unknown package $arg" >&2
    echo "usage: commit-check.sh [<server|client|reviewer-core|mcp>…]" >&2
    exit 64
  fi
  [[ " ${PACKAGES[*]-} " == *" $arg "* ]] || PACKAGES+=("$arg")
done

command -v jq >/dev/null 2>&1 || command -v node >/dev/null 2>&1 \
  || { echo "commit-check: neither jq nor node is on PATH, so the stamp cannot be written" >&2; exit 3; }

if [[ $# -eq 0 ]]; then
  TOUCHED="$(cg_touched_packages)" || { echo "commit-check: git could not read the state of $ROOT" >&2; exit 3; }
  while IFS= read -r pkg; do
    [[ -n "$pkg" ]] && PACKAGES+=("$pkg")
  done <<<"$TOUCHED"
fi

if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  echo "commit-check: no touched package, nothing to check"
  exit 0
fi

CHECK_CODE="$ROOT/.claude/agents/scripts/check-code.sh"
[[ -x "$CHECK_CODE" ]] || { echo "commit-check: $CHECK_CODE is missing or not executable" >&2; exit 3; }

LOG="$(mktemp "${TMPDIR:-/tmp}/commit-check.XXXXXX")" || { echo "commit-check: no temp file" >&2; exit 3; }
trap 'rm -f "$LOG"' EXIT

write_stamp() {
  local now="$1" rows="$2" old='{}' dir="${CG_STAMP%/*}" tmp
  if [[ -f "$CG_STAMP" ]] && cg_stamp_rows >/dev/null; then
    old="$(cat "$CG_STAMP")" || return 1
  fi
  mkdir -p "$dir" || return 1
  tmp="$(mktemp "$dir/last-green.XXXXXX")" || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg now "$now" --arg rows "$rows" --argjson old "$old" '
      ($rows | split("\n") | map(select(length > 0) | split("\t"))) as $checked
      | {version: 1, written_at: $now,
         packages: (reduce $checked[] as $row (($old.packages // {});
           .[$row[0]] = {green: ($row[1] == "true"), fingerprint: $row[2],
                         checked_at: $now, seconds: ($row[3] | tonumber)}))}' >"$tmp"
  else
    node -e '
      const [now, rows, old] = process.argv.slice(1);
      const packages = JSON.parse(old).packages || {};
      for (const line of rows.split("\n")) {
        if (line === "") continue;
        const [name, green, fingerprint, seconds] = line.split("\t");
        packages[name] = { green: green === "true", fingerprint, checked_at: now, seconds: Number(seconds) };
      }
      process.stdout.write(JSON.stringify({ version: 1, written_at: now, packages }, null, 2) + "\n");' \
      "$now" "$rows" "$old" >"$tmp"
  fi || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$CG_STAMP"
}

ROWS=""
SUMMARY=()
NOT_GREEN=0
for pkg in "${PACKAGES[@]}"; do
  start=$SECONDS
  green=true
  before="$(cg_fingerprint "$pkg")" || before=""
  : >"$LOG"
  "$CHECK_CODE" "$pkg" | while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line"
    printf '%s\n' "$line" >>"$LOG"
  done
  rc="${PIPESTATUS[0]}"
  passed=0
  failed=0
  while IFS= read -r line; do
    case "$line" in
      "ok "*) passed=$((passed + 1)) ;;
      FAIL*|SKIP*) failed=$((failed + 1)) ;;
    esac
  done <"$LOG"
  [[ "$rc" == 0 && "$passed" -gt 0 && "$failed" == 0 ]] || green=false
  after="$(cg_fingerprint "$pkg")" || after=""
  if [[ -z "$before" || -z "$after" ]]; then
    green=false
    echo "commit-check: git could not hash the files under $pkg/"
  elif [[ "$before" != "$after" ]]; then
    green=false
    echo "commit-check: files under $pkg changed while it was checked, run it again"
  fi
  seconds=$((SECONDS - start))
  ROWS+="$pkg"$'\t'"$green"$'\t'"$after"$'\t'"$seconds"$'\n'
  if [[ "$green" == true ]]; then
    SUMMARY+=("commit-check: $pkg green in ${seconds}s")
  else
    SUMMARY+=("commit-check: $pkg NOT green")
    NOT_GREEN=1
  fi
done

if ! write_stamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ROWS"; then
  rm -f "$CG_STAMP"
  echo "commit-check: could not write ${CG_STAMP#"$ROOT"/}, so no package is recorded green" >&2
  exit 3
fi

printf '%s\n' "${SUMMARY[@]}"
exit "$NOT_GREEN"
