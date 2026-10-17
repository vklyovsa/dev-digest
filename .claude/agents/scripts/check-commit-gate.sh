#!/usr/bin/env bash
# Checks the commit gate without a commit in this working copy.
#
#   check-commit-gate.sh [--only table|check|settings] [--cases <file>] [--verbose]
#
#   table     every row of commit-gate-cases.tsv through commit-gate.sh
#   check     assertions on commit-check.sh, with a stand-in for check-code.sh
#   settings  .claude/settings.json registers the gate beside guard-pr.sh
#
# Row (tab-separated): id · ac · state · mode · path · env · input · expected_exit · stderr_has
#   state       — a throwaway repository in that state (build_state lists them)
#   mode        — check (--check) · hook (the input wrapped into a Bash payload) · hook-raw
#                 (the input is the stdin as it stands) · both (check and hook must agree;
#                 the check run is handed a payload on stdin that asks for the other decision)
#   path        — full (the gate's tool budget) · nojq · nojqnode · nogit · noawk · nosed
#   env         — "-" or one assignment for the gate's environment, e.g. COMMIT_GATE_OVERRIDE=1
#   input       — \n is a line break, @OTHER@ a second throwaway repository, @EMPTY@ nothing
#   stderr_has  — substrings separated by |, all required, one starting with ! must be absent;
#                 "-" for none. Every stderr line of every row must begin with `commit-gate: `.
# Blank lines and lines starting with # are skipped.
#
# Every tool runs with the row's PATH, an empty HOME and CLAUDE_PROJECT_DIR set to the state.
# Git writes only inside repositories under one `mktemp -d` directory, which is removed on
# exit; HEAD and `git status --porcelain` of this working copy are compared before and after.
# Exit 0 everything matches · 1 a mismatch · 3 cannot run · 64 usage.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_NAMESPACE COMMIT_GATE_OVERRIDE

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REAL="$(cd "$DIR/../../.." && pwd -P)"
GATE="$DIR/commit-gate.sh"
CHECK="$DIR/commit-check.sh"
CASES="$DIR/commit-gate-cases.tsv"
ONLY=""
VERBOSE=0
BUDGET=(bash git jq node awk sed grep cat date mktemp mv mkdir rm)
DENIED_COMMIT='git commit -m x'
WORK=""
STATUS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --cases) CASES="${2:-}"; shift 2 ;;
    --verbose) VERBOSE=1; shift ;;
    *) echo "check-commit-gate.sh: unknown argument $1" >&2; exit 64 ;;
  esac
done
case "$ONLY" in
  ""|table|check|settings) ;;
  *) echo "check-commit-gate.sh: --only takes table, check or settings" >&2; exit 64 ;;
esac

die() {
  echo "check-commit-gate: $1" >&2
  exit 3
}

real_state() {
  GIT_OPTIONAL_LOCKS=0 git -C "$REAL" rev-parse HEAD \
    && GIT_OPTIONAL_LOCKS=0 git -C "$REAL" status --porcelain
}

tgit() {
  local repo="$1"
  shift
  case "$repo/" in
    "$WORK"/*) ;;
    *) die "refusing to run git outside the throwaway directory: $repo" ;;
  esac
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CEILING_DIRECTORIES="$WORK" git -C "$repo" \
    -c user.name=commit-gate -c user.email=commit-gate@example.invalid \
    -c commit.gpgsign=false -c init.defaultBranch=main "$@"
}

build_path() {
  local name="$1" tool source
  shift
  mkdir -p "$WORK/bin/$name" || die "cannot create $WORK/bin/$name"
  for tool in "${BUDGET[@]}"; do
    case " $* " in *" $tool "*) continue ;; esac
    source="$(command -v "$tool")" || die "$tool is not on PATH; the table needs every tool of the budget"
    ln -s "$source" "$WORK/bin/$name/$tool" || die "cannot link $tool"
  done
}

write_standin() {
  cat >"$1" <<'STANDIN'
#!/usr/bin/env bash
dir="$CLAUDE_PROJECT_DIR/.claude/commit-gate"
mkdir -p "$dir"
printf '%s\n' "$*" >>"$dir/standin-args"
mode=ok
[[ -f "$dir/standin-mode" ]] && read -r mode <"$dir/standin-mode"
pkg="${1:-}"
case "$mode" in
  ok|mutate)
    [[ "$mode" == mutate ]] && echo "written by the check" >>"$CLAUDE_PROJECT_DIR/$pkg/file.txt"
    echo "ok    $pkg typecheck — no errors (0s)"
    echo "ok    $pkg tests — Test Files 1 passed (1) · Tests 3 passed (3) (0s)"
    echo "logs: /nowhere"
    exit 0 ;;
  fail)
    echo "ok    $pkg typecheck — no errors (0s)"
    echo "FAIL  $pkg tests — Test Files 1 failed (1) · Tests 1 failed | 2 passed (3) (0s)"
    echo "      × stand-in excerpt: expected 1 to be 2"
    echo "logs: /nowhere"
    exit 1 ;;
  skip)
    echo "ok    $pkg typecheck — no errors (0s)"
    echo "SKIP  $pkg tests — exit 0 — no test executed, so this proves nothing (0s)"
    echo "logs: /nowhere"
    exit 0 ;;
  exit3)
    echo "check-code.sh: not inside the repository" >&2
    exit 3 ;;
esac
exit 64
STANDIN
  chmod +x "$1"
}

new_repo() {
  local repo="$1" folder
  mkdir -p "$repo" || die "cannot create $repo"
  tgit "$repo" init -q
  for folder in server client reviewer-core mcp specs .claude; do
    mkdir -p "$repo/$folder"
    echo baseline >"$repo/$folder/file.txt"
  done
  mkdir -p "$repo/.claude/agents/scripts"
  echo ".claude/commit-gate/" >"$repo/.gitignore"
  write_standin "$repo/.claude/agents/scripts/check-code.sh"
  tgit "$repo" add -A
  tgit "$repo" commit -q -m baseline || die "cannot commit the baseline of $repo"
}

setup() {
  local missing
  command -v jq >/dev/null 2>&1 && command -v node >/dev/null 2>&1 \
    || die "the table and the assertions need both jq and node"
  BEFORE="$(real_state)" || die "cannot read the state of $REAL"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/check-commit-gate.XXXXXX")" || die "no temp directory"
  trap 'rm -rf "$WORK"' EXIT
  WORK="$(cd "$WORK" && pwd -P)"
  case "$WORK/" in
    "$REAL"/*) die "the throwaway directory $WORK lies under $REAL" ;;
  esac
  mkdir -p "$WORK/home"
  build_path full
  build_path nojq jq
  build_path nojqnode jq node
  build_path nogit git
  build_path noawk awk
  build_path nosed sed
  new_repo "$WORK/baseline"
  new_repo "$WORK/other"
}

run_tool() {
  local repo="$1" path="$2" env="$3" extra=()
  shift 3
  [[ "$env" != "-" ]] && extra=("$env")
  (cd "$repo" && env -i PATH="$WORK/bin/$path" HOME="$WORK/home" CLAUDE_PROJECT_DIR="$repo" \
    ${extra[@]+"${extra[@]}"} "$@")
}

touch_package() {
  echo change >>"$1/$2/file.txt"
  echo new >"$1/$2/new.txt"
}

standin_mode() {
  mkdir -p "$1/.claude/commit-gate"
  echo "$2" >"$1/.claude/commit-gate/standin-mode"
}

green_check() {
  local repo="$1"
  shift
  standin_mode "$repo" ok
  run_tool "$repo" full - "$CHECK" "$@" </dev/null >/dev/null 2>&1 \
    || die "commit-check.sh did not end green in $repo, so the states cannot be built"
}

red_check() {
  standin_mode "$1" "$2"
  run_tool "$1" full - "$CHECK" </dev/null >/dev/null 2>&1
}

rewrite_stamp() {
  local stamp="$1/.claude/commit-gate/last-green.json" expression="$2" proof="$3"
  sed "$expression" "$stamp" >"$stamp.edit" && mv "$stamp.edit" "$stamp" \
    && grep -qF "$proof" "$stamp" || die "cannot edit the stamp of $1"
}

build_state() {
  local name="$1" repo="$WORK/state-$1" stamp content
  [[ -d "$repo" ]] && return 0
  cp -R "$WORK/baseline" "$repo" || die "cannot copy the baseline"
  stamp="$repo/.claude/commit-gate/last-green.json"
  mkdir -p "$repo/.claude/commit-gate"
  case "$name" in
    clean) ;;
    docs-only) echo change >>"$repo/specs/file.txt" ;;
    claude-only) echo change >>"$repo/.claude/file.txt" ;;
    server-touched) touch_package "$repo" server ;;
    untracked-only) echo new >"$repo/mcp/new.txt" ;;
    server-fresh) touch_package "$repo" server; green_check "$repo" ;;
    server-fresh-staged) touch_package "$repo" server; green_check "$repo"; tgit "$repo" add -A ;;
    server-fresh-rm-staged)
      touch_package "$repo" server; rm "$repo/server/file.txt"; green_check "$repo"; tgit "$repo" add -A ;;
    server-stale) touch_package "$repo" server; green_check "$repo"; echo later >>"$repo/server/file.txt" ;;
    server-stale-staged)
      touch_package "$repo" server; green_check "$repo"
      echo later >>"$repo/server/file.txt"; tgit "$repo" add -A ;;
    stamp-other-package) touch_package "$repo" server; green_check "$repo"; touch_package "$repo" client ;;
    two-fresh) touch_package "$repo" server; touch_package "$repo" client; green_check "$repo" ;;
    stamp-empty) touch_package "$repo" server; : >"$stamp" ;;
    stamp-truncated)
      touch_package "$repo" server; green_check "$repo"
      content="$(cat "$stamp")"
      printf '%s' "${content:0:$((${#content} / 2))}" >"$stamp" ;;
    stamp-no-packages)
      touch_package "$repo" server
      echo '{"version":1,"written_at":"2026-10-12T00:00:00Z"}' >"$stamp" ;;
    stamp-green-false)
      touch_package "$repo" server; green_check "$repo"
      rewrite_stamp "$repo" 's/"green": *true/"green": false/' '"green": false' ;;
    stamp-inject)
      touch_package "$repo" server; green_check "$repo"
      rewrite_stamp "$repo" 's/"fingerprint": *"[0-9a-f]*"/"fingerprint": "$(touch cg-probe)"/' '$(touch cg-probe)' ;;
    check-fail) touch_package "$repo" server; red_check "$repo" fail ;;
    check-skip) touch_package "$repo" server; red_check "$repo" skip ;;
    check-exit3) touch_package "$repo" server; red_check "$repo" exit3 ;;
    *) echo "check-commit-gate.sh: unknown state '$name'" >&2; exit 64 ;;
  esac
}

payload_for() {
  jq -cn --arg command "$1" '{tool_name: "Bash", tool_input: {command: $command}}'
}

attempt() {
  local kind="$1" repo="$2" path="$3" env="$4" command="$5" stdin="$6"
  if [[ "$kind" == check ]]; then
    run_tool "$repo" "$path" "$env" "$GATE" --check "$command" <"$stdin" >/dev/null 2>"$WORK/stderr"
  else
    run_tool "$repo" "$path" "$env" "$GATE" <"$stdin" >/dev/null 2>"$WORK/stderr"
  fi
  ACTUAL=$?
  ERR="$(cat "$WORK/stderr")"
}

run_table() {
  local total=0 failed=0 id ac state mode path env input expected has
  local repo command kinds kind problem part parts probe line
  [[ -f "$CASES" ]] || die "no case table at $CASES"
  while IFS=$'\t' read -r -u 9 id ac state mode path env input expected has || [[ -n "$id" ]]; do
    [[ -z "$id" || "$id" == \#* ]] && continue
    build_state "$state"
    repo="$WORK/state-$state"
    command="${input//@OTHER@/$WORK/other}"
    command="${command//\\n/$'\n'}"
    [[ "$command" == "@EMPTY@" ]] && command=""

    payload_for "$command" >"$WORK/payload"
    : >"$WORK/none"
    case "$mode" in
      check) kinds="check" ;;
      hook) kinds="hook" ;;
      hook-raw) kinds="hook"; printf '%s' "$command" >"$WORK/payload" ;;
      both)
        kinds="check hook"
        if [[ "$expected" == 0 ]]; then payload_for "$DENIED_COMMIT"; else payload_for "git status --short"; fi >"$WORK/none" ;;
      *) echo "check-commit-gate.sh: bad mode '$mode' in row $id" >&2; exit 64 ;;
    esac
    case "$path" in
      full|nojq|nojqnode|nogit|noawk|nosed) ;;
      *) echo "check-commit-gate.sh: bad path '$path' in row $id" >&2; exit 64 ;;
    esac

    problem=""
    for kind in $kinds; do
      if [[ "$kind" == check ]]; then
        attempt check "$repo" "$path" "$env" "$command" "$WORK/none"
      else
        attempt hook "$repo" "$path" "$env" "$command" "$WORK/payload"
      fi
      if [[ "$ACTUAL" != "$expected" ]]; then
        problem="$kind mode: expected $expected, got $ACTUAL"
        break
      fi
      if [[ "$has" != "-" ]]; then
        IFS='|' read -ra parts <<<"$has"
        for part in "${parts[@]}"; do
          if [[ "$part" == !* ]]; then
            [[ "$ERR" != *"${part#!}"* ]] || problem="$kind mode: stderr holds '${part#!}'"
          else
            [[ "$ERR" == *"$part"* ]] || problem="$kind mode: stderr lacks '$part'"
          fi
        done
        [[ -n "$problem" ]] && break
      fi
      while IFS= read -r line; do
        [[ -z "$line" || "$line" == "commit-gate: "* ]] && continue
        problem="$kind mode: a stderr line does not begin with the gate's name: $line"
      done <<<"$ERR"
      [[ "$ACTUAL" == 2 && -z "$ERR" ]] && problem="$kind mode: a refusal with nothing on stderr"
      [[ -n "$problem" ]] && break
    done

    total=$((total + 1))
    if [[ -n "$problem" ]]; then
      failed=$((failed + 1))
      printf 'FAIL  %s %s %s %s %s %s  %s  — %s\n' "$id" "$ac" "$state" "$mode" "$path" "$env" "$input" "$problem"
    elif [[ "$VERBOSE" == 1 ]]; then
      printf 'ok    %s %s %s %s %s %s  %s  → %s\n' "$id" "$ac" "$state" "$mode" "$path" "$env" "$input" "$expected"
    fi
  done 9<"$CASES"

  probe="$(find "$WORK" -name cg-probe 2>/dev/null)"
  [[ -e "$PWD/cg-probe" ]] && probe+=" $PWD/cg-probe"
  [[ -e "$REAL/cg-probe" ]] && probe+=" $REAL/cg-probe"
  if [[ -n "$probe" ]]; then
    echo "FAIL  a command or stamp text was executed, probe file found: $probe"
    STATUS=1
  fi

  echo "check-commit-gate: $((total - failed))/$total rows match"
  [[ "$failed" == 0 ]] || STATUS=1
}

CHECKS=0
CHECKS_FAILED=0
assert() {
  CHECKS=$((CHECKS + 1))
  if [[ "$2" != 0 ]]; then
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
    echo "FAIL  $1"
  elif [[ "$VERBOSE" == 1 ]]; then
    echo "ok    $1"
  fi
}

gate_exit() {
  run_tool "$1" full - "$GATE" --check "$DENIED_COMMIT" </dev/null >/dev/null 2>&1
  echo $?
}

run_check() {
  local repo="$WORK/check" args out rc before after mode
  args="$repo/.claude/commit-gate/standin-args"
  cp -R "$WORK/baseline" "$repo" || die "cannot copy the baseline"
  touch_package "$repo" server
  touch_package "$repo" client
  standin_mode "$repo" ok
  before="$(tgit "$repo" status --short)"

  out="$(run_tool "$repo" full - "$CHECK" </dev/null 2>&1)"
  rc=$?
  after="$(tgit "$repo" status --short)"
  [[ "$(cat "$args" 2>/dev/null)" == $'server\nclient' ]]
  assert "AC-12 without an argument check-code.sh receives the touched packages, one call each" $?
  [[ "$rc" == 0 && "$out" == *"commit-check: server green in "* && "$out" == *"commit-check: client green in "* ]]
  assert "AC-13 a run where every step ends ok exits 0 and names each package green" $?
  [[ "$(gate_exit "$repo")" == 0 ]]
  assert "AC-13 the commit command is allowed after a green run" $?
  [[ -f "$repo/.claude/commit-gate/last-green.json" && "$before" == "$after" ]]
  assert "AC-16 git status --short is the same before and after a green run" $?
  [[ "$out" == *"ok    server typecheck"* && "$out" == *"logs: /nowhere"* ]]
  assert "AC-15 the output holds the step lines of check-code.sh" $?

  for mode in fail skip exit3; do
    standin_mode "$repo" "$mode"
    out="$(run_tool "$repo" full - "$CHECK" </dev/null 2>&1)"
    rc=$?
    [[ "$rc" != 0 && "$out" == *"commit-check: server NOT green"* ]]
    assert "AC-14 a $mode run exits non-zero" $?
    [[ "$(gate_exit "$repo")" == 2 ]]
    assert "AC-14 the commit command is refused after a $mode run that followed a green one" $?
    if [[ "$mode" == fail ]]; then
      [[ "$out" == *"FAIL  server tests"* && "$out" == *"stand-in excerpt: expected 1 to be 2"* ]]
      assert "AC-15 a failing run prints the FAIL line and its excerpt" $?
    fi
  done

  standin_mode "$repo" ok
  run_tool "$repo" full - "$CHECK" </dev/null >/dev/null 2>&1
  [[ "$(gate_exit "$repo")" == 0 ]]
  assert "AC-13 a green run after a red one allows the commit command again" $?

  rm -f "$args"
  run_tool "$repo" full - "$CHECK" mcp </dev/null >/dev/null 2>&1
  rc=$?
  [[ "$rc" == 0 && "$(cat "$args" 2>/dev/null)" == mcp ]]
  assert "MI-3 a package argument is the only package checked" $?
  [[ "$(gate_exit "$repo")" == 0 ]]
  assert "MI-5 the entries of packages not checked now stay in the stamp" $?

  rm -f "$args"
  run_tool "$repo" full - "$CHECK" nonsense </dev/null >/dev/null 2>&1
  rc=$?
  [[ "$rc" == 64 && ! -e "$args" ]]
  assert "an unknown package name exits 64 before anything runs" $?

  run_tool "$repo" nojq - "$CHECK" </dev/null >/dev/null 2>&1
  rc=$?
  [[ "$rc" == 0 && "$(gate_exit "$repo")" == 0 ]]
  assert "NFR-5 without jq the stamp is written by node and read back as green" $?

  run_tool "$repo" nojqnode - "$CHECK" </dev/null >/dev/null 2>&1
  [[ $? == 3 ]]
  assert "NFR-5 without jq and node the test check exits 3" $?

  standin_mode "$repo" mutate
  out="$(run_tool "$repo" full - "$CHECK" server </dev/null 2>&1)"
  rc=$?
  [[ "$rc" != 0 && "$out" == *"files under server changed while it was checked"* && "$(gate_exit "$repo")" == 2 ]]
  assert "AC-7 a package whose files change during its check is not recorded green" $?

  repo="$WORK/check-clean"
  cp -R "$WORK/baseline" "$repo" || die "cannot copy the baseline"
  out="$(run_tool "$repo" full - "$CHECK" </dev/null 2>&1)"
  rc=$?
  [[ "$rc" == 0 && "$out" == *"no touched package, nothing to check"* && ! -e "$repo/.claude/commit-gate" ]]
  assert "AC-12 with no touched package nothing runs and no stamp is written" $?

  echo "check-commit-gate: $((CHECKS - CHECKS_FAILED))/$CHECKS assertions hold"
  [[ "$CHECKS_FAILED" == 0 ]] || STATUS=1
}

run_settings() {
  local file="$REAL/.claude/settings.json" problems
  command -v node >/dev/null 2>&1 || die "the settings check needs node"
  problems="$(node -e '
    const problems = [];
    let settings;
    try { settings = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); }
    catch (error) { console.log("not readable as JSON: " + error.message); process.exit(0); }
    const groups = ((settings.hooks || {}).PreToolUse || []).filter((group) => group.matcher === "Bash");
    const hooks = groups.flatMap((group) => group.hooks || []);
    const named = (name) => hooks.filter((hook) => typeof hook.command === "string" && hook.command.includes(name));
    if (groups.length === 0) problems.push("no PreToolUse group with the matcher Bash");
    if (!named("guard-pr.sh").some((hook) => hook.type === "command")) problems.push("the guard-pr.sh command hook is missing");
    const gate = named("commit-gate.sh");
    if (gate.length === 0) problems.push("no hook names commit-gate.sh");
    else {
      if (!gate.every((hook) => hook.type === "command")) problems.push("the commit-gate.sh hook is not type command");
      if (!gate.every((hook) => hook.timeout === 20)) problems.push("the commit-gate.sh hook does not declare timeout 20");
      if (!gate.every((hook) => hook.onFailure === "block")) problems.push("the commit-gate.sh hook does not declare onFailure block");
    }
    console.log(problems.join("\n"));' "$file")" || die "cannot read $file"
  if [[ -n "$problems" ]]; then
    while IFS= read -r problem; do
      echo "FAIL  settings — $problem"
    done <<<"$problems"
    echo "check-commit-gate: .claude/settings.json does not register the gate"
    STATUS=1
  else
    echo "check-commit-gate: .claude/settings.json registers the gate beside guard-pr.sh"
  fi
}

if [[ "$ONLY" != settings ]]; then
  setup
  [[ -z "$ONLY" || "$ONLY" == table ]] && run_table
  [[ -z "$ONLY" || "$ONLY" == check ]] && run_check
  AFTER="$(real_state)" || die "cannot read the state of $REAL"
  if [[ "$BEFORE" != "$AFTER" ]]; then
    echo "FAIL  HEAD or git status --porcelain of $REAL changed during the run"
    STATUS=1
  fi
fi
[[ -z "$ONLY" || "$ONLY" == settings ]] && run_settings

exit "$STATUS"
