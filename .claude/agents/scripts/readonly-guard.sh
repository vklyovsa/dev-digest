#!/usr/bin/env bash
# PreToolUse(Bash|Edit|MultiEdit|Write|NotebookEdit) gate for the read-only agents
# (architecture-reviewer, security-reviewer, plan-verifier, brainstorm, implementation-planner). Any file-writing tool is
# refused; Bash is an ALLOWLIST checked per segment — read-only git, text tools, static checks
# the pr-self-review scope scripts and the agent/guard/spec validators. It errs towards blocking.
#
#   readonly-guard.sh [--allow-tests]                     # hook mode, payload on stdin
#   readonly-guard.sh [--allow-tests] --check "<cmd>"
#   readonly-guard.sh [--allow-tests] --check-tool <Tool>
#   readonly-guard.sh [--allow-tests] --check-path "<p>"  # always blocks: nothing is writable
#
# --allow-tests also admits vitest runs and check-code.sh (plan-verifier proves acceptance
# criteria with them); without it check-code.sh passes only as `--no-tests`, the static half.
# --bash-only judges commands only and lets every tool and path through: write-scope-guard
# --profile specs hands its Bash calls here and decides the file writes itself.
set -uo pipefail
trap 'rc=$?; [[ $rc == 0 || $rc == 2 ]] || { echo "BLOCKED: ${0##*/} failed (exit $rc), so it fails closed." >&2; exit 2; }' EXIT

GUARD_NAME=readonly-guard
GUARD_HINT='This agent is read-only; list what you could not check under "Not checked" / "Not verifiable".'
# shellcheck source=guard-lib.sh
source "${BASH_SOURCE[0]%/*}/guard-lib.sh" || exit 2

ALLOW_TESTS=0
BASH_ONLY=0
while [[ "${1:-}" == "--allow-tests" || "${1:-}" == "--bash-only" ]]; do
  if [[ "$1" == "--allow-tests" ]]; then ALLOW_TESTS=1; else BASH_ONLY=1; fi
  shift
done
[[ "$BASH_ONLY" == 1 ]] \
  && GUARD_HINT='Bash is read-only for this agent: use Read / Grep / Glob instead, or name what you could not check in your report.'

GIT_RO="${GIT}(--no-pager[[:space:]]+)?(status|diff|log|show|blame|grep|ls-files|ls-tree|rev-parse|rev-list|merge-base|cat-file|describe|shortlog|name-rev|for-each-ref)([[:space:]]|$)"
TEXT_TOOLS='^(ls|cat|head|tail|wc|grep|egrep|rg|find|sort|uniq|cut|tr|sed|diff|cmp|comm|nl|jq|realpath|readlink|dirname|basename|stat|file|du|tree|date|echo|printf|test|\[|true|false|cd|pwd|which|type|read|column|paste|tac|rev)([[:space:]]|$)'
STATIC='^(pnpm[[:space:]]+(run[[:space:]]+)?(typecheck|arch:check)|npm[[:space:]]+run[[:space:]]+typecheck|pnpm[[:space:]]+exec[[:space:]]+(depcruise|tsc[[:space:]].*--noEmit)|npx[[:space:]]+(depcruise|tsc[[:space:]].*--noEmit))([[:space:]]|$)'
SCOPE_SCRIPTS='^([^[:space:]]*/)?\.claude/(skills/pr-self-review/scripts/(collect-diff|route-skills)|agents/scripts/check-(agents|guards|spec))\.sh([[:space:]]|$)|^bash[[:space:]]+-n[[:space:]]'
CODE_CHECK='^([^[:space:]]*/)?\.claude/agents/scripts/check-code\.sh([[:space:]]|$)'
CODE_CHECK_STATIC='check-code\.sh([[:space:]]+(--it|server|client|reviewer-core|mcp))*[[:space:]]+--no-tests([[:space:]]|$)'
TESTS='^(pnpm[[:space:]]+(run[[:space:]]+)?test|npm[[:space:]]+(run[[:space:]]+)?test|(pnpm[[:space:]]+exec|npx|pnpm)[[:space:]]+vitest[[:space:]]+run)([[:space:]]|$)'

allowed_git() {
  local s="$1"
  grep -Eq "$GIT_RO" <<<"$s" && return 0
  grep -Eq "${GIT}(remote[[:space:]]+(-v|show|get-url)|stash[[:space:]]+(list|show)|worktree[[:space:]]+list|config[[:space:]]+--get)([[:space:]]|$)" <<<"$s" && return 0
  if grep -Eq "${GIT}branch([[:space:]]|$)" <<<"$s"; then
    local args
    args="$(sed -E "s/${GIT}branch//" <<<"$s")"
    grep -Eq '(^|[[:space:]])(-[dDmMcCf]|--delete|--move|--copy|--force|--set-upstream-to|-u|--unset-upstream|--edit-description)([[:space:]]|$)' <<<"$args" && return 1
    grep -Eq '(^|[[:space:]])[^-[:space:]]' <<<"$args" && ! grep -Eq -- '--(contains|merged|no-merged|points-at|sort|format)' <<<"$args" && return 1
    return 0
  fi
  return 1
}

check_segment() {
  local s="$1"
  [[ -z "$s" ]] && return 0
  s="$(sed -E 's/^(if|then|else|elif|while|until|do|!|\{)[[:space:]]+//' <<<"$s")"
  [[ -z "$s" ]] && return 0
  grep -Eq '^(done|fi|else|then|do|\}|:)$' <<<"$s" && return 0
  grep -Eq '^for[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]+in([[:space:]]|$)' <<<"$s" && return 0

  if grep -Eq '^git([[:space:]]|$)' <<<"$s"; then
    allowed_git "$s" && return 0
    block "$s" "only read-only git (status, diff, log, show, blame, grep, ls-files, rev-parse, …) is allowed."
  fi
  if grep -Eq "$TEXT_TOOLS" <<<"$s"; then
    grep -Eq '^find([[:space:]].*)?[[:space:]]-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)([[:space:]]|$)' <<<"$s" \
      && block "$s" "find may only list files here."
    grep -Eq '^sed([[:space:]].*)?[[:space:]](-[A-Za-z]*i[A-Za-z.]*|--in-place)([[:space:]=]|$)' <<<"$s" && block "$s" "sed may only print here."
    grep -Eq '^sort([[:space:]].*)?[[:space:]](-[A-Za-z]*o[A-Za-z]*|--output)([[:space:]=]|$)' <<<"$s" && block "$s" "sort may only print here."
    return 0
  fi
  grep -Eq "$STATIC" <<<"$s" && return 0
  grep -Eq "$SCOPE_SCRIPTS" <<<"$s" && return 0
  if grep -Eq "$CODE_CHECK" <<<"$s"; then
    [[ "$ALLOW_TESTS" == 1 ]] || grep -Eq "$CODE_CHECK_STATIC" <<<"$s" \
      || block "$s" "this agent does not run tests; run check-code.sh --no-tests <package>, or name the command under \"Needs a test run\" / \"Not checked\"."
    return 0
  fi
  if grep -Eq "$TESTS" <<<"$s"; then
    [[ "$ALLOW_TESTS" == 1 ]] || block "$s" "this agent does not run tests; name the command under \"Needs a test run\" / \"Not checked\"."
    grep -Eq '(^|[[:space:]])(-u|--update|--watch|-w)([[:space:]]|$)' <<<"$s" \
      && block "$s" "tests run once and never rewrite snapshots."
    return 0
  fi
  block "$s" "not on the read-only allowlist (read-only git, text tools, typecheck/depcruise, collect-diff.sh, route-skills.sh, check-agents.sh, check-guards.sh, check-spec.sh, check-code.sh --no-tests, bash -n$([[ "$ALLOW_TESTS" == 1 ]] && echo ', check-code.sh, vitest run'))."
}

check_command() {
  local cmd="$1" seg
  [[ -z "$cmd" ]] && return 0
  lib_has_file_redirect "$cmd" && block "$cmd" "redirecting output into a file is a write."
  grep -Eq -- '--output(-to)?([=[:space:]]|$)' <<<"$(lib_strip_quotes "$cmd")" \
    && block "$cmd" "writing command output to a file is a write."
  while IFS= read -r seg; do
    check_segment "$(normalize "$seg")"
  done < <(segments "$(lib_strip_quotes "$cmd")")
}

check_tool() {
  [[ "$BASH_ONLY" == 1 ]] && return 0
  block "$1" "this agent is read-only: no file-writing tools."
}

check_path() {
  [[ "$BASH_ONLY" == 1 ]] && return 0
  block "${1:-<no path>}" "this agent is read-only: nothing is writable."
}

lib_main "$@"
