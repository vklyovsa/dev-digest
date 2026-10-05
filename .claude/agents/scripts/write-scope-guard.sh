#!/usr/bin/env bash
# PreToolUse(Bash|Edit|MultiEdit|Write|NotebookEdit) gate for the agents that write only one
# kind of file: test-writer (--profile tests), doc-writer (--profile docs) and spec-creator
# (--profile specs).
# Edit/Write: a path ALLOWLIST per profile. Bash: the shared denylist (git history, PRs,
# dev-DB writes, the Docker volume) plus installs, the dev/e2e stacks, project-wide
# formatting and file-mutating commands. The specs profile is stricter on Bash: it hands
# every command to readonly-guard.sh --bash-only, an allowlist. On files it admits a dated
# spec in a spec folder — a new one, or an existing one whose header says `Status: draft`
# — and that folder's README.md.
#
#   write-scope-guard.sh --profile tests|docs|specs                    # hook mode, payload on stdin
#   write-scope-guard.sh --profile tests|docs|specs --check "<cmd>"
#   write-scope-guard.sh --profile tests|docs|specs --check-path "<p>"
#   write-scope-guard.sh --profile tests|docs|specs --check-tool <Tool>
set -uo pipefail
trap 'rc=$?; [[ $rc == 0 || $rc == 2 ]] || { echo "BLOCKED: ${0##*/} failed (exit $rc), so it fails closed." >&2; exit 2; }' EXIT

PROFILE=""
if [[ "${1:-}" == "--profile" ]]; then
  PROFILE="${2:-}"
  shift 2 || true
fi

GUARD_NAME="write-scope-guard ($PROFILE)"
GUARD_HINT='Record it under "Not done / blockers" (or "Gaps") in your report.'
# shellcheck source=guard-lib.sh
source "${BASH_SOURCE[0]%/*}/guard-lib.sh" || exit 2

case "$PROFILE" in
  tests|docs) ;;
  specs) GUARD_HINT='Say so in your report: a change outside the spec folders belongs to another agent or to the user.' ;;
  *) block "every tool call" "write-scope-guard needs --profile tests, --profile docs or --profile specs." ;;
esac

TEST_PATHS='^(client/src/.+\.test\.tsx?|client/src/test/.+|server/test/.+|server/src/.+\.test\.ts|reviewer-core/test/.+|reviewer-core/src/.+\.test\.ts|(server|reviewer-core)/tsconfig\.test-check\.json)$'
DOC_PATHS='^(docs/[^/]+\.md|(server|client|reviewer-core|e2e)/docs/[^/]+\.md|README\.md|(server|client|reviewer-core|e2e)/README\.md|server/src/modules/[^/]+/README\.md|TESTING\.md|AGENTS\.md|(server|client|reviewer-core|e2e)/AGENTS\.md)$'
SPEC_DIRS='(specs|server/specs|client/specs|reviewer-core/specs|mcp/specs)'
SPEC_FILE="^${SPEC_DIRS}/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*\.md\$"
SPEC_INDEX="^${SPEC_DIRS}/README\.md\$"
TEST_THROWAWAY='^(rm)([[:space:]]+-f)?[[:space:]]+(\./)?(server|reviewer-core)/tsconfig\.test-check\.json$|^rm([[:space:]]+-f)?[[:space:]]+(\./)?tsconfig\.test-check\.json$'
RUNNERS='^((pnpm|npm|yarn)[[:space:]]+(run[[:space:]]+)?(test|e2e)([[:space:]:]|$)|(pnpm[[:space:]]+exec|npx|pnpm|yarn)[[:space:]]+(vitest|jest|playwright)([[:space:]]|$)|vitest([[:space:]]|$))'

check_segment() {
  local s="$1"
  [[ -z "$s" ]] && return 0
  lib_check_git_segment "$s"
  lib_check_db_segment "$s"

  if grep -Eq '^(pnpm|npm|yarn)[[:space:]]+(add|install|i|remove|rm|uninstall|update|up|upgrade|ci|dlx|link)([[:space:]]|$)' <<<"$s" \
    || { grep -Eq '^npx[[:space:]]' <<<"$s" && ! grep -Eq '^npx[[:space:]]+(tsc|vitest)([[:space:]]|$)' <<<"$s"; }; then
    block "$s" "dependencies are not changed by this agent; a missing one is a blocker for the implementer."
  fi
  if grep -Eq '^([^[:space:]]*/)?scripts/(dev|e2e)\.sh([[:space:]]|$)|^agent-browser([[:space:]]|$)' <<<"$s"; then
    block "$s" "the dev / e2e stacks are started by the user: a stack started from an agent session dies with it (INSIGHTS.md § Recurring Errors)."
  fi
  if grep -Eq '^([^[:space:]]*/)?prettier[[:space:]].*(--write|-w)([[:space:]]|$)|^(npx|pnpm[[:space:]]+exec)[[:space:]]+prettier[[:space:]].*(--write|-w)([[:space:]]|$)|^(pnpm|npm|yarn)[[:space:]]+(run[[:space:]]+)?[A-Za-z0-9_-]*:fix([[:space:]]|$)' <<<"$s"; then
    block "$s" "project-wide formatting rewrites files outside this agent's scope."
  fi
  if grep -Eq '^([^[:space:]]*/)?\.claude/agents/scripts/check-code\.sh([[:space:]]|$)' <<<"$s"; then
    [[ "$PROFILE" == docs ]] && block "$s" "doc-writer does not run tests."
    return 0
  fi
  if grep -Eq "$RUNNERS" <<<"$s"; then
    [[ "$PROFILE" == docs ]] && block "$s" "doc-writer does not run tests."
    grep -Eq '(^|[[:space:]])(-u|--update|--watch|-w)([[:space:]]|$)' <<<"$s" \
      && block "$s" "tests run once and never rewrite snapshots."
    grep -Eq '(^|[[:space:]])(e2e|playwright)([[:space:]:]|$)' <<<"$s" \
      && block "$s" "browser e2e is out of this agent's scope."
    grep -Eq 'vitest' <<<"$s" && ! grep -Eq 'vitest[[:space:]]+run([[:space:]]|$)' <<<"$s" \
      && block "$s" "use \`vitest run\`: bare vitest starts watch mode and never exits."
    return 0
  fi
  if [[ "$PROFILE" == tests ]] && grep -Eq "$TEST_THROWAWAY" <<<"$s"; then
    return 0
  fi
  if grep -Eq '^(rm|rmdir|mv|cp|tee|touch|mkdir|chmod|chown|ln|truncate|dd|install|shred|unlink)([[:space:]]|$)' <<<"$s"; then
    block "$s" "files are changed with the Edit/Write tools only, inside this agent's scope."
  fi
  if grep -Eq '^(sed|perl)([[:space:]].*)?[[:space:]](-[A-Za-z]*i[A-Za-z.]*|--in-place)([[:space:]=]|$)' <<<"$s"; then
    block "$s" "in-place edits bypass the path check; use the Edit tool."
  fi
  if grep -Eq '^(node|python3?|perl|ruby)[[:space:]]+(-e|-c|--eval)([[:space:]]|$)|^(bash|sh|zsh|dash)[[:space:]]+(-[a-z]*c)([[:space:]]|$)|^(eval|xargs|source|\.)([[:space:]]|$)' <<<"$s"; then
    block "$s" "inline scripts can write anywhere; use the Edit/Write tools."
  fi
  return 0
}

check_command() {
  local cmd="$1" seg
  [[ -z "$cmd" ]] && return 0
  if [[ "$PROFILE" == specs ]]; then
    "${BASH_SOURCE[0]%/*}/readonly-guard.sh" --bash-only --check "$cmd" || exit 2
    return 0
  fi
  lib_check_psql "$cmd"
  lib_has_file_redirect "$cmd" && block "$cmd" "redirecting output into a file bypasses the path check; use the Write tool."
  while IFS= read -r seg; do
    check_segment "$(normalize "$seg")"
  done < <(segments "$(lib_strip_quotes "$cmd")")
}

check_path() {
  local p="$1" rel
  [[ -z "$p" ]] && return 0
  rel="$(lib_repo_rel "$p")" || exit 2
  lib_check_protected_path "$rel"
  if grep -Eq '(^|/)CLAUDE\.md$' <<<"$rel"; then
    block "$rel" "CLAUDE.md is a one-line @AGENTS.md import; instructions go into AGENTS.md."
  fi
  if grep -Eq '(^|/)INSIGHTS\.md$' <<<"$rel"; then
    block "$rel" "INSIGHTS.md is append-only through .claude/skills/engineering-insights/scripts/append-insight.sh."
  fi
  if [[ "$PROFILE" == specs ]]; then
    grep -Eq "$SPEC_INDEX" <<<"$rel" && return 0
    grep -Eq "$SPEC_FILE" <<<"$rel" \
      || block "$rel" "spec-creator writes specs only: <YYYY-MM-DD>-<feature-slug>.md in specs/, server/specs/, client/specs/, reviewer-core/specs/ or mcp/specs/, plus that folder's README.md (the Open specs list)."
    grep -Eq -- '-plan\.md$' <<<"$rel" \
      && block "$rel" "an Implementation Plan is saved from implementation-planner's output; spec-creator does not write it."
    # The header is everything above the first `## ` heading; only its Status line counts.
    if [[ -e "$ROOT/$rel" ]] \
      && [[ "$(sed -n '/^## /q;p' "$ROOT/$rel" | grep -m1 -E '^Status:' | sed -E 's/[[:space:]]+$//')" != "Status: draft" ]]; then
      block "$rel" "only a spec whose header says \`Status: draft\` is changed; an approved or implemented one is replaced by a new spec with Supersedes."
    fi
    return 0
  fi
  if grep -Eq '^(specs/|[^/]+/specs/|\.claude/|client/src/vendor/|server/src/vendor/)' <<<"$rel"; then
    block "$rel" "specs hold intent, .claude holds the tooling, vendor/ holds the shared contracts — none of them is this agent's to write."
  fi
  case "$PROFILE" in
    tests)
      [[ "$rel" == client/src/test/setup.ts ]] \
        && block "$rel" "the shared test setup is production-grade infrastructure; a change there is a gap for the implementer."
      grep -Eq "$TEST_PATHS" <<<"$rel" \
        || block "$rel" "test-writer edits test files only (*.test.ts(x), server/test/**, reviewer-core/test/**, client/src/test/**, the throwaway tsconfig.test-check.json); production code needed for a test is a gap for the implementer."
      ;;
    docs)
      grep -Eq "$DOC_PATHS" <<<"$rel" \
        || block "$rel" "doc-writer edits docs only: docs/<topic>.md, <package>/docs/<topic>.md, README.md files, TESTING.md, AGENTS.md (Read when links)."
      ;;
  esac
  return 0
}

check_tool() {
  [[ "$1" == NotebookEdit ]] && block "$1" "notebooks are outside this agent's scope."
  return 0
}

lib_main "$@"
