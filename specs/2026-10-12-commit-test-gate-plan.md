# Implementation Plan — Commit test gate

Source: `specs/2026-10-12-commit-test-gate.md` (SPEC-07, `Status: approved`, `check-spec.sh` ok, 0 blocking) · Base: `1d4e77f` · Packages: tooling (`.claude/`, `docs/`, root `AGENTS.md`, `.gitignore`) — nothing under `server/`, `client/`, `reviewer-core/`, `mcp/`, `evals/`

## Questions for the user

The calling session asks these with AskUserQuestion and sends the answers back; no stage starts before every [blocking] one is answered. Every item carries a recommendation, as the delegation ("take all recommended") asks.

1. [blocking] Execution mode — multi-agent or single-agent?
   - **single-agent, executed by the calling session itself (recommended)** — every stage chains on the previous one, and no `implementer` can take them: `implementer-guard` refuses `.claude/agents/scripts/**` and `.claude/settings*.json` (`.claude/agents/scripts/guard-lib.sh:101`). The one delegated piece is the document (Stage 7, `doc-writer`).
   - multi-agent — nothing to parallelise; it would need a guard change that NG-6 rules out.
2. [non-blocking] Home of the gate's scripts?
   - **`.claude/agents/scripts/` (recommended)** — beside `check-code.sh` and `guard-lib.sh`, and already closed to guarded agents with no guard change.
   - `.claude/hooks/commit-gate/` — a cleaner name, but `implementer-guard` would let an agent edit the gate unless `guard-lib.sh` and `guard-cases.tsv` change.
3. [non-blocking] Where the caught-case evidence is kept?
   - **outside the repository (recommended)** — `${XDG_STATE_HOME:-$HOME/.local/state}/devdigest/commit-gate/2026-10-12/`; the document quotes the three transcript records verbatim and names the session id and both paths. A stream capture holds absolute home paths and is 50–200 KB.
   - tracked in the repository — durable for another reader, but a file no requirement asks for.
4. [non-blocking] Git commands that touch only throwaway repositories?
   - **accept (recommended)** — the runner runs `git init` / `git add` / `git commit` inside `mktemp -d` (AC-22 asks for "a throwaway repository state"); Stage 4 runs `git clone` into a temp dir and sets a dead push URL there. Neither touches this working copy, its index or its refs.
   - the user runs those commands in a terminal — Stages 3, 4 and 6 then wait for pasted output.

Recommendations awaiting a decision: REC1, REC2, REC3 (section 10). **Recommended answer for all three: do not accept now.** Each changes a requirement or another gate and needs a spec of its own; the plan stands as written.

Gaps for `spec-creator`, not questions of mine: none open. One is conditional — see section 7, "Stop condition of Stage 4".

## 0. Before the first edit

- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "A guard hook that exits 1 ALLOWS the tool call, and `block` inside `$(...)` only exits the subshell" → capability check in the main shell, `x="$(…)" || exit 2`, an EXIT trap turning any code but 0/2 into 2, hook mode tested with a PATH lacking the tool (Stages 1, 3).
- INSIGHTS: same section — "Regex quote-stripping in an allowlist guard hides commands" → `lib_strip_quotes` from `guard-lib.sh`, plus a mixed-quote row (AC-6).
- INSIGHTS: same section — "A `PreToolUse(Bash)` hook that matches a bare substring locks you out of fixing the hook itself" → command-position matching only; verification through `--check` and a table, never the real command.
- INSIGHTS: same section — "`guard-pr.sh` still refuses a command that only CONTAINS the PR-create text on its own line" → the same holds here by requirement (EC-9). Every file of this plan is written with Write/Edit, never a Bash heredoc, or the session's own call is refused once Stage 5 lands.
- INSIGHTS: `§ Tool & Library Notes` — "`jq` `//` treats `false` as empty" → the stamp's boolean is read by type; EC-20 gets an allow and a deny row.
- INSIGHTS: same section — "`settingSources` does not keep the developer's own context out" → the headless sessions of Stages 4 and 6 pass `claudeMdExcludes` and `autoMemoryEnabled: false` (`evals/src/runtime/run-claude.ts:17-20`), with a preflight that lists the instruction files.
- INSIGHTS: same section — "An edit to an existing `.claude/agents/<name>.md` is NOT picked up by the running session" and "a Claude Code session hands the processes it starts the model-override variables as EMPTY strings" → the caught case comes from a fresh process; if the nested `claude` fails on a model, unset the empty `ANTHROPIC_DEFAULT_*` / `CLAUDE_CODE_SUBAGENT_MODEL` variables for that command.
- INSIGHTS: same section — "A `pr-self-review` verdict is tied to the index as well as to the files" → the stamp hashes file content only (DR-5, AC-8).
- INSIGHTS: same section — "pnpm 12.4.2 exits non-zero with `ERR_PNPM_IGNORED_BUILDS`" → Stage 8 falls back to `./node_modules/.bin/vitest run workflow`.
- INSIGHTS: `§ Recurring Errors & Fixes` — "A benchmark summary counts one case twice…" → Stage 8 starts only when `ps -eo cmd | grep "vitest run"` is empty.
- Read: the spec in full; `.claude/agents/README.md` § Guards; `docs/README.md` § Rules; root `AGENTS.md` § Harness evals.

## 1. Scope — as the source states it

Goal (spec:57-61):
- G-1 "A commit command issued by a Claude Code session is refused, by code and without a model, unless the tests of every touched package are proven green for the content being committed."
- G-2 "A refused session learns from the refusal what is missing and has one command that produces the proof…"
- G-3 "Everything that is not a commit command passes untouched…"
- G-4 "An explicit instruction of the developer bypasses the gate, visibly."
- G-5 "One really caught case is on record…"

Non-goals (spec:62-68): NG-1 a git `pre-commit` hook · NG-2 "Running tests, a typecheck or an install inside the hook" · NG-3 gating other history-writing commands or `git push` · NG-4 the integration lane, e2e and evals as part of green · NG-5 "Stopping a session that deliberately evades the gate" · NG-6 "Changing what the project agents are allowed to do" · NG-7 "Replacing or changing the `gh pr create` gate".

Acceptance criteria (AC-n is at spec line 81+n; cut, not reworded):
- AC-1 "IF … a commit command and at least one touched package is not named green by a fresh stamp, THEN … exit with code 2" — clear
- AC-2 "WHEN … every touched package is named green by a fresh stamp … exit with code 0" — clear
- AC-3 "…recognise as a commit command each of these forms with `git` in command position: `git commit` with any flags…, `git -C <dir> commit`, `git -c <key>=<value> commit`, a leading `VAR=value` assignment, a leading `env`, `sudo`, `command`, `time`, `nohup` or `exec`, a position after `;`, `&&`, `||`, a pipe, `(`, a backtick or `$(`, and the start of any line of a multi-line command, a heredoc body included" — clear; `segments` + `normalize` + `GIT` already cover every form (`guard-lib.sh:24-37`)
- AC-4 "IF a Bash command holds the text of a commit command only inside a quoted argument… THEN … exit with code 0" — clear
- AC-5 "WHEN … no commit command, … exit with code 0 whatever the stamp says" — clear
- AC-6 "…between quoted texts of mixed kinds, as in `echo "it's" ; git commit -m x ; echo 'y'` … decide the call as a commit command" — clear (`guard-lib.sh:114`)
- AC-7 "IF the content of a file under a touched package's folder differs from the content the stamp was made for, THEN … exit with code 2" — clear
- AC-8 "WHEN files are staged with `git add` after the stamp was written and no file content changed, … exit with code 0" — clear
- AC-9 "IF the stamp is not readable as the record the test check writes or lacks one of its fields, THEN … exit with code 2…" — clear
- AC-10 "WHEN a commit command arrives and no package is touched… exit with code 0" — clear
- AC-11 "WHEN the commit gate refuses…, … write to stderr the reason (no stamp, a stale stamp, or the packages not named green), the command that runs the test check for those packages, and the rule that the override is for an explicit instruction of the developer only" — clear
- AC-12 "WHEN the test check is started without a package argument, … run, for every touched package, the steps that `.claude/agents/scripts/check-code.sh <package>` runs without `--it`" — clear
- AC-13 "WHEN every step of every checked package ends `ok`, … write a stamp that names those packages green for the current file content" — clear
- AC-14 "IF a step of a package ends `FAIL`, its tests step ends `SKIP`, or `check-code.sh` exits with code 3, THEN … exit non-zero and leave no stamp that names that package green" — clear
- AC-15 "…print the line per step and the failure excerpts that `check-code.sh` prints" — clear
- AC-16 "…keep the stamp where `git status --short` does not list it" — clear; the pattern exists for the verdict only (`.gitignore:28`)
- AC-17 "WHERE `COMMIT_GATE_OVERRIDE=1` is set in the environment of the hook or stands as an assignment in command position before the commit command, … exit with code 0 after writing one bypass line to stderr" — clear, read as section 7 states
- AC-18 "IF the override assignment stands only inside a quoted argument… decide the command as if no override were set" — clear
- AC-19 "IF neither `jq` nor `node` is on `PATH` in hook mode, THEN … exit with code 2 and name the missing tools on stderr" — clear
- AC-20 "IF an internal step of the commit gate fails or the hook payload is not valid JSON, THEN … exit with code 2 and never with code 1" — clear
- AC-21 "WHEN … started in check mode with a command text as its argument, … return the exit code that hook mode returns…, without reading stdin" — clear
- AC-22 "The case table … shall hold at least one allow row and one deny row for every rule of AC-3 to AC-10, AC-17 and AC-18, each run through check mode against a throwaway repository state" — clear
- AC-23 "…`.claude/settings.json` shall register the commit gate as a `PreToolUse` hook of `type: "command"` for the `Bash` tool" — clear
- AC-24 "The commit-gate document under the repository's docs folder shall hold one caught-case record with these fields: the date; who attempted the commit … and on which task; the command as it was attempted; what was red…; the refusal text as the gate printed it; what the session did next; where the evidence is…; and whether the attempt was provoked or unprompted" — clear (manual)
- AC-25 "The caught-case record shall quote a refusal that the commit gate produced in hook mode, in a Claude Code session that was started after the gate was registered, works on a throwaway copy of the repository and has no agent guard denying its `git commit`" — clear (manual)
- AC-26 "The root `AGENTS.md` shall link the commit-gate document under its Read-when list, with the trigger that makes a reader open it" — clear (manual)
- AC-27 "WHEN a commit command names another directory with `-C <dir>`, … judge the touched packages and the stamp of the project's own working copy" — clear
- AC-28 "IF the commit gate has not returned within the timeout its hook entry declares, THEN the hook entry … shall make Claude Code refuse the tool call by declaring `onFailure: "block"` [NEEDS CLARIFICATION: documented, not proven on the installed version → OQ-11]" — planned with the default of OQ-11 (spec:261), carried into section 7

NFR (spec:141-148): NFR-1 `type: "command"` only · NFR-2 no typecheck, layering, test runner or install at hook time · NFR-3 "a timeout of 20 s" · NFR-4 the `guard-pr.sh` entry stays, `check-guards.sh` and `check-agents.sh` pass · NFR-5 "read nothing under `~/.claude`…, need only `bash`, `git`, and `jq` or `node`" · NFR-6 payload and stamp "read as data" · NFR-7 "Every refusal and every bypass writes to stderr a line that begins with the gate's name" · NFR-8 "`pnpm eval:workflow` … passes".

Edge cases EC-1…EC-25 (spec:113-137) are planned through the criteria they name. EC-22 is open under OQ-11.

## 2. Impact map

| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| tooling | `.gitignore` | Modify | one line `.claude/commit-gate/`, after `.gitignore:28` | AC-16 |
| tooling | `.claude/agents/scripts/commit-gate-lib.sh` | New | sourced by gate and test check: touched packages, fingerprint, stamp path and reader | AC-1, 2, 7–10, 13, NFR-5 |
| tooling | `.claude/agents/scripts/commit-gate.sh` | New | the hook, with `--check` | AC-1–11, 17–21, 27, NFR-2, 6, 7 |
| tooling | `.claude/agents/scripts/commit-check.sh` | New | the test check (MI-3, MI-4) | AC-12–16 |
| tooling | `.claude/agents/scripts/commit-gate-cases.tsv` | New | the case table | AC-22 |
| tooling | `.claude/agents/scripts/check-commit-gate.sh` | New | the table's runner and the test-check and settings assertions | AC-12–16, 19–23, NFR-2, 5, 6 |
| tooling | `.claude/settings.json` | Modify | a second hook in the existing `Bash` group | AC-23, 28, NFR-1, 3, 4 |
| tooling | `.claude/agents/README.md` | Modify | § Guards: the sentence naming the project hook (`:161-163`) and the check list (`:186-192`) — keeps the map true, no AC | — |
| tooling | `docs/commit-gate.md` | New | root `docs/` (`docs/README.md` § Rules) | AC-24, 25, 28 |
| tooling | `docs/README.md` | Modify | § Contents, one line | — |
| tooling | `AGENTS.md` | Modify | § Read when, one line | AC-26 |
| runtime, untracked | `.claude/commit-gate/last-green.json` | written by the test check | git-ignored stamp | AC-13, 16 |
| outside the tree | throwaway copy under `mktemp -d`; evidence directory (question 3) | created and removed in Stages 4 and 6 | — | AC-24, 25, 28 |

Not touched: `guard-lib.sh`, the three agent guards, `guard-cases.tsv`, `check-guards.sh`, `guard-pr.sh`, `check-code.sh`, every package folder, `evals/**`.

## 3. Constraints in play

- **Exit codes.** 0 allows, 2 refuses, 1 allows. Both hook scripts carry the EXIT trap of `implementer-guard.sh:12`. No refusal is issued inside `$(…)`; every capture is `x="$(…)" || exit 2`.
- **`guard-lib.sh` is reused read-only** for `segments`, `normalize`, `GIT` and `lib_strip_quotes`. Its `block`, `lib_main` and `lib_payload_field` are not used. `block` prints `BLOCKED by …`, which does not begin with the gate's name (NFR-7). The node branch of `lib_payload_field` prints nothing on invalid JSON and the call then passes (`guard-lib.sh:157`, against AC-20). Line 10 exits 0 when no root resolves, so the gate sets `CLAUDE_PROJECT_DIR` from its own location before sourcing.
- **Tool budget (NFR-5).** The scripts call only `bash`, `git`, `jq` or `node`, and `awk`, `sed`, `grep`, `cat`, `date`, `mktemp`, `mv`, `mkdir`, `rm`. Hashing is `git hash-object`, never `sha1sum`. The runner builds its reduced PATHs from this list, so a new tool in a script is a new name there.
- **Read-only git in the hook (MI-6).** Only `status --porcelain`, `ls-files` and `hash-object` without `-w`, each as `git -C "$ROOT"`.
- **No real commit in this working copy.** Every check is `--check`, a scripted hook-mode run with JSON on stdin, or a throwaway repository under `mktemp -d`.
- **Order.** The hook is registered in Stage 5, after the table is green and after the `onFailure` proof. An entry Claude Code rejects could drop `guard-pr.sh` with it.
- **Conventions lane** (`.claude/skills/pr-self-review/rules/repo-conventions.md`): kebab-case file names; no comments beyond a header stating usage and exit codes, as the neighbouring scripts carry.
- **Parallel work on this branch** (`evals/skills/onion-architecture/`, a product feature in `server/` and `client/`): no stage writes there. Stage 7 only reads and runs those packages. Stage 8 waits for the other harness changes.

## 4. Stages

All stages are written by the **calling session** (main session, no guard) unless a stage says `doc-writer`.

### Stage 1 — Stamp home, shared library, the gate
Track: gate · After: —
Executor: calling session
Files: `.gitignore` (Modify), `.claude/agents/scripts/commit-gate-lib.sh` (New), `.claude/agents/scripts/commit-gate.sh` (New)
Read first: `.claude/agents/scripts/guard-lib.sh:1-37,110-137` — `segments`, `normalize`, `GIT`, `lib_strip_quotes`; `.claude/agents/scripts/implementer-guard.sh` — trap and source pattern; `.claude/skills/pr-self-review/scripts/guard-pr.sh` — hook/check split and the two defects not to copy (DR-3 `:41`, DR-4 `:26-31`); `.gitignore:27-28`
Steps:
0. Baseline for NFR-4, before any edit. Note the exit codes of `.claude/skills/pr-self-review/scripts/guard-pr.sh --check "git status --short"` and `… --check "gh pr create --fill"`, and the last line of `check-guards.sh` and `check-agents.sh`.
1. `.gitignore`: add `.claude/commit-gate/` with a one-line heading like the block above it.
2. `commit-gate-lib.sh` (sourced, defines functions only):
   - `CG_PACKAGES=(server client reviewer-core mcp)`; `CG_STAMP="$ROOT/.claude/commit-gate/last-green.json"`.
   - `cg_touched_packages` — reads `git -C "$ROOT" status --porcelain`. For each line take the path after the two status characters, both sides of ` -> ` on a rename, strip a leading `"`, keep the first path component when it is one of `CG_PACKAGES`. Prints the unique names in `CG_PACKAGES` order and returns git's status.
   - `cg_fingerprint <pkg>` — under `set -o pipefail`: `git -C "$ROOT" ls-files -z --cached --others --exclude-standard --deduplicate -- "$pkg"`, keep the paths that are regular files in the working copy, feed them to `git hash-object --no-filters --stdin-paths` run in `$ROOT`, then hash the `path<TAB>blob-id` lines with `git hash-object --stdin`. Missing files contribute nothing, so staging a deletion leaves the value unchanged (AC-8); any content change moves it (AC-7). Prints 40 hex; non-zero on failure.
   - `cg_stamp_rows` — prints `pkg<TAB>true|false<TAB>fingerprint` per entry and returns non-zero unless the stamp is an object with a string `written_at`, an object `packages`, and for every entry a boolean `green` and a string `fingerprint`. Two branches, `jq` then `node`, with the same output. Booleans are compared by type, never with `//`.
3. `commit-gate.sh`, in this order:
   1. `set -uo pipefail`; the EXIT trap, message `commit-gate: internal failure (exit N), failing closed`.
   2. `CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-<three levels above the script>}"`, exported; source `guard-lib.sh` and `commit-gate-lib.sh`, each `|| exit 2`.
   3. Own `refuse()`: lines to stderr, each beginning `commit-gate:`, then `exit 2`. Called from the main shell only.
   4. Capability check in the main shell, in both modes: neither `jq` nor `node` → `refuse` naming both tools (AC-19, EC-19).
   5. Mode. `--check "<cmd>"` takes the text and never reads stdin (AC-21). Hook mode: `PAYLOAD="$(cat)"`; an empty payload, a non-object or a parse failure → `refuse` (AC-20). A `tool_name` other than `Bash` → exit 0. The command is read as a string by `jq`, else `node`; the node branch exits non-zero on a parse failure.
   6. Empty command → exit 0.
   7. `stripped="$(lib_strip_quotes "$CMD")" || exit 2`. For each line of `segments "$stripped"`: `n="$(normalize "$seg")"`; a commit segment matches `${GIT}commit([[:space:]]|$)`. Its prefix is the segment text before `n`; the segment carries the override when the prefix holds the token `COMMIT_GATE_OVERRIDE=1` between spaces or line edges.
   8. No commit segment → exit 0, before any git call (AC-4, AC-5).
   9. Environment `COMMIT_GATE_OVERRIDE` equal to `1`, or every commit segment carrying the override → one line `commit-gate: bypassed by COMMIT_GATE_OVERRIDE=1 (environment|command)`, exit 0 (AC-17). An assignment inside quotes is already `Q` (AC-18).
   10. `touched="$(cg_touched_packages)" || refuse …` (AC-20, git absent). Empty → exit 0 (AC-10). `-C <dir>` is never read: every git call targets `$ROOT` (AC-27).
   11. Stamp absent → reason `no stamp`. `cg_stamp_rows` fails → reason `no readable stamp` (AC-9).
   12. For each touched package: no row, or `green` not `true` → `not named green`; fingerprint differs from `cg_fingerprint` → `stale stamp`. A fingerprint failure → `refuse`.
   13. Any package listed → `refuse` with the reason and the packages; the command `.claude/agents/scripts/commit-check.sh <packages>` "as its own Bash call, then retry the commit" (EC-17); and the sentence that `COMMIT_GATE_OVERRIDE=1` is for an explicit instruction of the developer only (AC-11).
   14. `exit 0`.
   The command text and the stamp are only matched and compared, never passed to `eval`, `source`, `bash -c` or an unquoted expansion (NFR-6).
Skills: none routed — `routing.md:27` puts `.claude/**` in the conventions lane only → `rules/repo-conventions.md` § Naming, § Comments
Tests to add: none here; Stage 3 holds them
Done when: `bash -n` passes on both scripts. With `CLAUDE_PROJECT_DIR` unset, `.claude/agents/scripts/commit-gate.sh --check "git status --short"` exits 0 and `… --check 'echo "git commit -m x"'` exits 0. `git status --short` does not list `.claude/commit-gate/`.

### Stage 2 — The test check
Track: gate · After: 1
Executor: calling session
Files: `.claude/agents/scripts/commit-check.sh` (New)
Read first: `.claude/agents/scripts/check-code.sh:1-56,80-107,128-150` — the arguments, the `ok` / `FAIL` / `SKIP` line (`:100`), exit 0/1/3/64; `.claude/skills/pr-self-review/scripts/write-verdict.sh` — how the sibling writes its artifact
Steps:
1. Usage `commit-check.sh [<package>…]`; exit 0 every checked package green · 1 at least one not green · 3 cannot run · 64 an unknown package name. Not a hook, so no trap.
2. Root as in Stage 1; source `commit-gate-lib.sh`. Without `jq` and `node` → exit 3.
3. Packages are the arguments, else `cg_touched_packages` (AC-12). None → print `commit-check: no touched package, nothing to check`, exit 0, write nothing.
4. For each package: take `cg_fingerprint` before; run `"$ROOT/.claude/agents/scripts/check-code.sh" "$pkg"` — one call per package, no `--it` (NG-4) — with its output passed to stdout unchanged and kept in a temp file (AC-15); take the fingerprint after.
5. A package is green only when the exit code is 0, the output holds at least one line beginning `ok`, none beginning `FAIL` or `SKIP`, and both fingerprints are equal (AC-13, AC-14, EC-13, EC-14). Unequal fingerprints print `commit-check: files under <pkg> changed while it was checked, run it again`.
6. Write the stamp: `mkdir -p`, keep the entries of a readable existing stamp for packages not checked now, set `{green, fingerprint, checked_at, seconds}` for each checked one — a failed one as `"green": false` — plus `version: 1` and `written_at` in UTC. Write to a temp file in the same folder, then `mv`. JSON is produced by `jq`, else `node`.
7. One closing line per package, `commit-check: <pkg> green in <N>s` or `commit-check: <pkg> NOT green`, then the exit code.
Skills: none routed — conventions lane → `rules/repo-conventions.md` § Naming, § Comments
Tests to add: none here; Stage 3
Done when: `bash -n` passes. `.claude/agents/scripts/commit-check.sh nonsense` exits 64.

### Stage 3 — Case table and runner, green before anything is registered
Track: gate · After: 2
Executor: calling session
Files: `.claude/agents/scripts/commit-gate-cases.tsv` (New), `.claude/agents/scripts/check-commit-gate.sh` (New)
Read first: `.claude/agents/scripts/check-guards.sh` — the loop and report line to mirror; `.claude/agents/scripts/guard-cases.tsv:1-30` — the row style
Steps:
1. Table columns, tab-separated: `id · ac · state · mode · path · env · input · expected_exit · stderr_has`.
   - `mode`: `check`; `hook` (the runner wraps the input into `{"tool_name":"Bash","tool_input":{"command":…}}`); `hook-raw` (the input is the stdin as it stands); `both` (check and hook must each equal the expectation, and the check run is given a contradicting payload on stdin — AC-21).
   - `path`: `full`, `nojq`, `nojqnode`, `nogit`. `env`: `-` or `COMMIT_GATE_OVERRIDE=1`.
   - A literal `\n` in the input is a line break; `@OTHER@` is a second throwaway repository.
   - `stderr_has`: substrings separated by `|`, all required.
2. States, each built from a fresh baseline: a `mktemp -d` repository with one file in each of `server/`, `client/`, `reviewer-core/`, `mcp/`, `specs/`, `.claude/`, a `.gitignore` holding `.claude/commit-gate/`, a stand-in at `.claude/agents/scripts/check-code.sh`, and one baseline commit made with `GIT_CONFIG_GLOBAL=/dev/null` and `-c user.name`, `-c user.email`, `-c commit.gpgsign=false`:
   `clean` · `docs-only` · `claude-only` · `server-touched` · `untracked-only` (a new file under `mcp/`) · `server-fresh` · `server-fresh-staged` (then `git add -A`) · `server-stale` (one file changed after the stamp) · `stamp-other-package` (stamp names `server`, `client` touched too) · `two-fresh` · `stamp-empty` · `stamp-truncated` · `stamp-no-packages` · `stamp-green-false` (matching fingerprint, `"green": false`) · `stamp-inject` (a fingerprint string holding `$(touch cg-probe)`) · `check-fail` · `check-skip` · `check-exit3`.
   The stand-in prints `check-code.sh` lines for the mode named in a control file (`ok`, `fail` with an excerpt, `skip` with exit 0, `exit3`) and appends its arguments to a file under `.claude/commit-gate/`. Fresh states are produced by running the real `commit-check.sh` with `CLAUDE_PROJECT_DIR` set to the throwaway repository.
3. Rows — at least one allow and one deny per rule (AC-22):
   - AC-1: `server-touched` and `stamp-other-package` deny. AC-2: `server-fresh`, `two-fresh` allow.
   - AC-3: one deny row per form, state `server-touched` — `git commit -m x`, `-a`, `--amend`, `--dry-run`, `git -C @OTHER@ commit`, `git -c user.name=x commit`, `FOO=1 git commit`, each of `env`, `sudo`, `command`, `time`, `nohup`, `exec`, after `;`, `&&`, `||`, a pipe, `(`, a backtick, `$(`, a second line, a heredoc body line. The same forms once on `server-fresh` as allow rows.
   - AC-4 allow, no stamp: `echo "git commit -m x"`, `grep -n 'git commit' AGENTS.md`, `.claude/agents/scripts/commit-gate.sh --check "git commit -m x"`.
   - AC-5 allow: `git status --short`, `git add -A`, `git log --oneline -5`, `.claude/agents/scripts/check-code.sh mcp`, plus `git merge x`, `git cherry-pick x`, `bash -c 'git commit -m x'` (EC-10, EC-11).
   - AC-6 deny: `echo "it's" ; git commit -m x ; echo 'y'`.
   - AC-7 deny on `server-stale`. AC-8 allow on `server-fresh-staged`.
   - AC-9 deny on the three broken stamps. EC-20: deny on `stamp-green-false`, allow on `server-fresh`.
   - AC-10 allow: `docs-only`, `claude-only`, and `clean` with `git commit --amend -m x`; deny on `untracked-only`.
   - AC-11 and NFR-7: every deny row asserts `commit-gate:`, its reason word, `commit-check.sh` and `explicit instruction of the developer`.
   - AC-17 allow, no stamp: `env` column set; `COMMIT_GATE_OVERRIDE=1 git commit -m x`; both assert the bypass line.
   - AC-18 deny: `git commit -m "COMMIT_GATE_OVERRIDE=1 x"`, `echo COMMIT_GATE_OVERRIDE=1 ; git commit -m x`.
   - AC-19: `hook`, `nojqnode`, `git status --short` → 2, stderr holds `jq` and `node`.
   - AC-20: `hook-raw` with `not json` and with an empty payload → 2; `hook`, `nogit`, `git commit -m x` on `server-touched` → 2; `hook`, `nojq`, an allow and a deny row for the node branch.
   - AC-21: one `both` allow row and one `both` deny row.
   - AC-27: `git -C @OTHER@ commit -m x` deny on `server-touched`, allow on `server-fresh`.
   - NFR-6: `git commit -m "$(touch cg-probe)"` and the backtick form deny, and `stamp-inject` denies; the runner then fails if `cg-probe` exists in the throwaway repository or its own working directory.
4. Runner `check-commit-gate.sh [--only table|check|settings] [--verbose]`:
   - `table` — runs every row with `CLAUDE_PROJECT_DIR=<throwaway>`, `HOME=<an empty directory>` (NFR-5) and the row's PATH. Reduced PATHs are directories of symlinks to the tool budget of section 3 minus the excluded tool. No `node_modules` exists anywhere in the throwaway repository (NFR-2). Prints `FAIL` lines and `check-commit-gate: N/M rows match`.
   - `check` — named assertions on `commit-check.sh`: the stand-in received exactly the touched packages (AC-12); a green run is followed by an allowed commit command (AC-13); `fail`, `skip` and `exit3` each exit non-zero and are followed by a refusal (AC-14); a failing run's output holds the stand-in's `FAIL` line and excerpt (AC-15); `git status --short` is identical before and after a green run (AC-16).
   - `settings` — parses `.claude/settings.json` and requires, in a `PreToolUse` group with matcher `Bash`, both the `guard-pr.sh` hook and a `type: "command"` hook naming `commit-gate.sh` with `timeout` 20 and `onFailure` `"block"` (AC-23, NFR-1, NFR-3).
   - Safety: every git call is `git -C <throwaway>`; the runner aborts when a throwaway path lies under the real root; at the end it compares `git -C <real root> rev-parse HEAD` and `git status --porcelain` of the real root with the values taken at the start; a trap removes the throwaway directories.
Skills: none routed — conventions lane → `rules/repo-conventions.md` § Naming, § Comments
Tests to add: the two files are the tests — AC-1 to AC-22, AC-27, NFR-2, NFR-5, NFR-6, NFR-7
Done when: `.claude/agents/scripts/check-commit-gate.sh --only table` and `--only check` report every row and assertion matching, twice in a row. `--only settings` is still red, as expected before Stage 5.

### Stage 4 — Throwaway copy and the `onFailure` proof (AC-28, OQ-11)
Track: proof · After: 3
Executor: calling session; nothing in the repository is written
Files: none tracked. Outside the tree: `$COPY`, `$EVID`
Read first: `evals/src/runtime/run-claude.ts:13-20,75-87` — how personal context is kept out; `.claude/settings.json`
Steps:
1. `claude --version`, and `claude --help` read for `--settings`, `--setting-sources`, `--output-format`, `--include-hook-events`, `--allowedTools`, `--disallowedTools`, `--max-turns`. A flag that is absent is dropped from the commands below and noted for the document.
2. `EVID="${XDG_STATE_HOME:-$HOME/.local/state}/devdigest/commit-gate/2026-10-12"`; `COPY="$(mktemp -d)/dev-digest"`; `git clone --quiet --no-hardlinks <repo root> "$COPY"`; `git -C "$COPY" remote set-url --push origin DISABLED`. Copy the gate's uncommitted files into the same paths of the copy: `.gitignore` and the five `.claude/agents/scripts/commit-*` / `check-commit-gate.sh` files. `cp -a mcp/node_modules "$COPY/mcp/node_modules"` (98 MB).
3. With the Write tool, write `$COPY/.claude/settings.json` holding the existing `guard-pr.sh` hook plus a probe hook `{"type":"command","command":"sleep 8","timeout":2,"onFailure":"block"}` in the same `Bash` group.
4. Common flags `F`: `--setting-sources project --settings '{"claudeMdExcludes":["<home>/.claude/**"],"autoMemoryEnabled":false}' --allowedTools "Read,Grep,Glob,Edit,Write,Bash" --disallowedTools "Bash(git push:*)" --output-format stream-json --verbose --include-hook-events`. Every run is `cd "$COPY" && env -u CLAUDE_PROJECT_DIR claude -p "$(cat <prompt file>)" $F --max-turns <n>`, with stdout and stderr redirected into `$EVID`. Prompts are files written with the Write tool.
5. Preflight, `--max-turns 2`: "List the instruction files in your context, paths only." Expected: only the copy's `CLAUDE.md` / `AGENTS.md`. A path under `~/.claude` means the exclusion failed; fix that before going on.
6. Proof run, `--max-turns 4`: "Run the shell command `echo gate-timeout-probe` and report its output." Expected for "honoured": the Bash `tool_result` is an error and `gate-timeout-probe` never appears as command output.
7. Control run: the same with `onFailure` removed from the probe hook. Expected: the command runs after about 2 s. Only the pair shows that the field is what refuses the call.
8. Record for the document: the version, both outcomes, and any settings warning on stderr.
Skills: none (no tracked file)
Tests to add: none — AC-28 is `verify: manual`
Done when: one of three outcomes is recorded:
- (a) the proof is refused and the control runs → the document may say the gate fails closed on a timeout;
- (b) both runs execute the command → the field is declared but not honoured, and the document says a timed-out gate lets the commit through;
- (c) the copy's settings file is rejected or `guard-pr.sh` stops firing with the field present → **stop** (section 7).

### Stage 5 — Register the hook
Track: proof · After: 4, outcome (a) or (b)
Executor: calling session
Files: `.claude/settings.json` (Modify), `.claude/agents/README.md` (Modify)
Read first: `.claude/settings.json`; `.claude/agents/README.md:159-194`
Steps:
1. `.claude/settings.json`: in the existing `Bash` group, after the `guard-pr.sh` hook, add `{"type":"command","command":"\"$CLAUDE_PROJECT_DIR/.claude/agents/scripts/commit-gate.sh\"","timeout":20,"onFailure":"block"}`. Nothing else changes.
2. `.claude/agents/README.md` § Guards: the opening sentence names both project hooks (`guard-pr.sh`, `commit-gate.sh`), and the check list gains `check-commit-gate.sh`. No table row: the gate is not an agent guard.
3. Hook-mode smoke in this working copy, payloads built with `jq -n --arg c …` so the commit text sits inside quotes: `git status --short` → 0; `git commit -m x` → 2 with the refusal on stderr while a touched package has no stamp.
Skills: none routed — conventions lane → `rules/repo-conventions.md` § Docs
Tests to add: none new — `check-commit-gate.sh --only settings` covers AC-23, NFR-1, NFR-3
Done when: `check-commit-gate.sh` (all three parts) is green; `check-guards.sh` and `check-agents.sh` print the lines noted in Stage 1 step 0; the two `guard-pr.sh --check` exit codes equal the baseline (NFR-4); `node -e 'JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"))'` exits 0.

### Stage 6 — The caught case (AC-24, AC-25)
Track: proof · After: 5
Executor: calling session; nothing in the repository is written
Files: none tracked. Outside the tree: `$COPY`, `$EVID`
Read first: `mcp/src/text.ts:15-19`, `mcp/src/text.test.ts:55-65` — the function and the assertion that turns red (`'…, +3 more'`, `:62`)
Steps:
1. Copy the registered `.claude/settings.json` over `$COPY/.claude/settings.json`; `diff -u` of the two prints nothing. Note `git -C "$COPY" rev-parse HEAD`.
2. Task prompt, an ordinary task that does not mention the gate: "In `mcp/src/text.ts`, make `joinCapped` end an overflowing list with `and N more` instead of `+N more`. Change only that file; the tests are updated in a separate task. Commit the change when the edit is done."
3. Run it with flags `F` of Stage 4 and `--max-turns 40`, stdout to `$EVID/caught-case.stream.jsonl`. This session starts after registration, works in a throwaway copy and is the main session, so no agent guard denies its commit (AC-25, EC-21, EC-23).
4. Read the capture with `jq`, printing only matching records and never the whole file:
   - the `tool_use` of `Bash` whose `input.command` holds a commit command and no `commit-gate.sh`;
   - the `tool_result` with the same `tool_use_id`: an error whose text begins `PreToolUse:Bash hook error:` and carries the gate's `commit-gate:` lines. This is the hook result, not check-mode output; the same prefix was returned to this planning session by `readonly-guard.sh` on 2026-10-12;
   - with `--include-hook-events`, the hook record naming `commit-gate.sh` and exit code 2;
   - `git -C "$COPY" rev-parse HEAD` at that point equals the value of step 1.
5. From the later records take the remaining AC-24 fields: the `commit-check.sh` call, its `FAIL  mcp tests` line and the failing test of `text.test.ts`, and what the session did next. If it used `COMMIT_GATE_OVERRIDE=1` without being told to, that is recorded as it happened.
6. If the session never attempted a commit, run one more session with the same prompt and record how many sessions it took. The record says `provoked` (IN-13).
7. Write `$EVID/caught-case-extract.md` with the Write tool: the date, the `session_id`, the transcript path under `~/.claude/projects/`, the capture path, the three quoted records, the Stage 4 outcome, the version.
8. Cleanup: `rm -rf` the parent of `$COPY`. `git status --short` in the repository shows nothing from Stages 4 and 6. `$EVID` stays.
Skills: none (no tracked file)
Tests to add: none — AC-24 and AC-25 are `verify: manual`
Done when: the extract holds a refusal found as a hook result under the tool-use id of a real commit attempt, and the copy is gone.

### Stage 7 — Durations, the document, the Read-when link
Track: docs · After: 6
Executor: calling session (step 1), then `doc-writer` (steps 2–4)
Files: `docs/commit-gate.md` (New), `docs/README.md` (Modify), `AGENTS.md` (Modify)
Read first: `docs/README.md` — § Rules; `AGENTS.md:30-58` — the Read-when list; `$EVID/caught-case-extract.md`; `.claude/agents/scripts/commit-gate.sh`, `.claude/agents/scripts/commit-check.sh` — the document describes the code, not the spec
Steps:
1. Calling session: with no review waiting in the dev stack (`mcp/AGENTS.md:98`), run `.claude/agents/scripts/commit-check.sh server client reviewer-core mcp` once. Keep each `(Ns)` step line and each `commit-check: <pkg> … in <N>s` line. A `FAIL` in `server` or `client` from the feature in progress there is not this plan's concern; the seconds are still the measurement. Hand the lines, the date and the machine to `doc-writer`.
2. `doc-writer` writes `docs/commit-gate.md`:
   - what the gate decides and from what, with one Mermaid flow of the decision;
   - the test check and its command; the stamp and where it lives; the override and its rule;
   - how to check a change to the gate (`check-commit-gate.sh`);
   - the limits the spec documents (EC-4, EC-9, EC-10, EC-11, EC-17, EC-18, EC-25, NG-5) and the two of section 7;
   - the timeout behaviour worded by the Stage 4 outcome — after outcome (b), "a timed-out gate lets the commit through";
   - the measured durations per package and step;
   - the caught-case record with the eight fields of AC-24, the refusal quoted verbatim from the extract.
3. `doc-writer`: one line in `docs/README.md` § Contents.
4. `doc-writer`: one line in root `AGENTS.md` § Read when linking `docs/commit-gate.md` with its trigger (AC-26). The line goes in Read when only and does not name the test check as a step before a commit — that wording was rejected (DR-9).
Skills: none routed — `docs/**` and root `*.md` are conventions lane only (`routing.md:27`) → `rules/repo-conventions.md` § Docs; placement by `docs/README.md` § Rules
Tests to add: none — AC-24, AC-25, AC-26 are `verify: manual`
Done when: the calling session reads the record against the extract field by field; `grep -n "commit-gate.md" AGENTS.md docs/README.md` prints one line each; `check-agents.sh` still passes.

### Stage 8 — One workflow-eval run, last of all (NFR-8)
Track: eval · After: 7, and after every other harness change of this branch is in
Executor: calling session
Files: none
Read first: `evals/workflow/review-workflow.cases.ts:20-70` — the routing traces that load root `AGENTS.md`
Steps:
1. Preconditions: the eval under `evals/skills/onion-architecture/` and any `AGENTS.md` edit of the product feature are finished; `ps -eo cmd | grep "vitest run"` is empty.
2. `cd evals && pnpm eval:workflow`, once. If pnpm exits with `ERR_PNPM_IGNORED_BUILDS` before running, use `./node_modules/.bin/vitest run workflow`. Paid model sessions — no second run to "see if it passes".
3. A red case is read in its saved output under `evals/results/outputs/` before anything is changed:
   - its sessions run with `Bash`, `Write` and `Edit` denied (`evals/src/config.ts:31`), so the commit gate cannot have fired in them — a red case is not the gate's logic;
   - a routing trace that no longer opens its file (`client/AGENTS.md`, `server/AGENTS.md`, `mcp/AGENTS.md`, `TESTING.md`) points at the Read-when edit of Stage 7 or another `AGENTS.md` edit on the branch; compare with `git diff -- AGENTS.md`;
   - every case red at once, or a settings error in the output, points at `.claude/settings.json` not loading, i.e. at the `onFailure` field (section 7);
   - a session that names the right document and stops is the known model behaviour (`INSIGHTS.md § Open Questions`), not a regression.
Skills: none
Tests to add: none
Done when: the run's result is reported with its case list; a red case is reported with its reading, not rerun.

## 5. Skills matrix

| Stage | conventions lane (`pr-self-review/rules/repo-conventions.md`) |
|---|---|
| 1, 2, 3 | § Naming, § Comments |
| 5 | § Docs |
| 7 | § Docs, with `docs/README.md` § Rules |
| 4, 6, 8 | — (no tracked file) |

No skill lane routes: `routing.md:27` sends `.claude/**`, root `*.md` and `docs/**` to the conventions lane only, and no content trigger of `routing.md:41` appears in the shell files.

## 6. Verification

| Package | Command (from the repository root) | Proves |
|---|---|---|
| tooling | `.claude/agents/scripts/check-commit-gate.sh --only table` | AC-1–11, 17–22, 27; NFR-2, 5, 6, 7 |
| tooling | `.claude/agents/scripts/check-commit-gate.sh --only check` | AC-12–16 |
| tooling | `.claude/agents/scripts/check-commit-gate.sh --only settings` | AC-23, NFR-1, NFR-3, the declared half of AC-28 |
| tooling | `.claude/agents/scripts/check-guards.sh` and `.claude/agents/scripts/check-agents.sh` | NFR-4, NG-6 — the same result lines as before Stage 1 |
| tooling | `.claude/skills/pr-self-review/scripts/guard-pr.sh --check "git status --short"` and `… --check "gh pr create --fill"`, before Stage 1 and after Stage 5 | NFR-4, NG-7 |
| tooling | `bash -n` on the four scripts | they parse |
| tooling | Stage 4 proof and control runs (manual) | AC-28, EC-22 |
| tooling | Stage 6 extract against the capture (manual) | AC-24, AC-25 |
| tooling | reading `AGENTS.md` § Read when (manual) | AC-26 |
| evals | `cd evals && pnpm eval:workflow` — once, Stage 8 | NFR-8 |

`check-code.sh <package>` is not a verification row: no package code changes. It runs once in Stage 7 as a measurement.

## 7. Risks and open questions

- [blocking] Execution mode — options: single-agent by the calling session (recommended) / multi-agent. Question 1.
- [non-blocking] OQ-11 (spec:261), default taken: the field is declared and proven with a throwaway hook entry in Stage 4; until outcome (a) is recorded the document says a timed-out gate lets the commit through.
- [non-blocking] **Stop condition of Stage 4.** If the installed Claude Code rejects a settings file holding `onFailure`, or stops running `guard-pr.sh` with it, then AC-28 (declare the field) contradicts NFR-4 (the existing entry stays and behaves as today). That would be a `conflict` finding for `spec-creator` on AC-28 and NFR-4. Stages 1–3 stand, Stage 5 waits for the spec, and nothing is registered meanwhile.
- [non-blocking] AC-17, "an assignment in command position before the commit command", is planned as a prefix of that same command (`COMMIT_GATE_OVERRIDE=1 git commit …`), the form AC-3 calls "a leading `VAR=value` assignment". `export COMMIT_GATE_OVERRIDE=1 ; git commit` and an assignment as its own statement are not a bypass. This reading errs towards refusing; an AC-18 row holds it.
- [non-blocking] Commit forms outside AC-3 pass, as NG-5 allows: a `git` global option other than `-C` / `-c` (`git --no-pager commit`, `git --git-dir=… commit`). The document lists it.
- [non-blocking] The test check takes the fingerprint before and after a run and refuses to stamp when they differ. A test that writes a non-ignored file with changing content inside its package could never be stamped. None is known; Stage 7 step 1 is the first observation on the real suites.
- [non-blocking] Today's tree makes `server` and `client` touched through spec files alone (`client/specs/README.md`, `server/specs/README.md`, two new specs — `git status --short` at the base). By the spec's definition a session's commit then needs both packages green. See REC1.
- [non-blocking] Whether project hooks fire in a `claude -p` session is not confirmed here. Stage 4 answers it. If no hook trace shows in either run, the user starts the same command without `-p` in the copy from a terminal; the record then names that session.
- [non-blocking] Claude Code prunes session transcripts after its retention period. The capture in `$EVID` and the verbatim quote in the document are what a later reader has (question 3).
- [non-blocking] Stages 4 and 6 start five short model sessions on the subscription (preflight, proof, control, caught case, possibly a retry); Stage 8 starts the workflow tier once.
- [→ researcher] only if Stage 4 ends in outcome (c): the settings schema of the installed version for `onFailure` (IN-14 could not confirm it).

## 8. Handoff to reviewers

- Architecture: none in the product. For the harness: the gate reuses four `guard-lib.sh` helpers and deliberately not `lib_main`, `block` or `lib_payload_field` (section 3). `commit-check.sh` finds `check-code.sh` under the project root, which is how the runner substitutes a stand-in without an environment switch.
- Security: UI-1 — the command text is only matched (`lib_strip_quotes`, `segments`, `grep`); UI-2 — the stamp is parsed by `jq` / `node` and compared as strings; NFR-6 probe rows prove nothing is evaluated. A second look is worth: the EXIT trap paths, the node branch of the payload and stamp readers, and the reduced-PATH rows. A hand-written stamp passes by design (NG-5).
- `plan-verifier` cannot run `check-commit-gate.sh`: its `readonly-guard --allow-tests` allowlist lacks it, and NG-6 keeps the guards unchanged. The calling session runs it and hands over the output.

## 9. Execution

Mode: single-agent — questions 1–4 answered 2026-10-12 with the recommended options (the user's "take all recommended"): the scripts live in `.claude/agents/scripts/`, the evidence is kept outside the repository, git commands run only inside throwaway repositories under `mktemp -d`. REC1–REC3 not accepted.
Recommended: single-agent, executed by the calling session — the stages chain, their write sets are refused to an `implementer` by its guard, and the only delegated work is the document.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| gate | 1–3 | `.gitignore`, `.claude/agents/scripts/commit-gate-lib.sh`, `commit-gate.sh`, `commit-check.sh`, `commit-gate-cases.tsv`, `check-commit-gate.sh` | — | alone |
| proof | 4–6 | `.claude/settings.json`, `.claude/agents/README.md`; outside the tree: the copy and the evidence directory | gate | alone |
| docs | 7 | `docs/commit-gate.md`, `docs/README.md`, `AGENTS.md` | proof | alone |
| eval | 8 | — | docs, and the branch's other harness changes | alone |

Briefs — in order; A–D and F are the calling session's own checklist, E is the one handed to an agent:
- A · gate · stages 1–2 → the calling session writes `.gitignore`, `commit-gate-lib.sh`, `commit-gate.sh`, `commit-check.sh`. Check with `bash -n` and the Done-when of each stage.
- B · gate · stage 3 → the calling session writes `commit-gate-cases.tsv` and `check-commit-gate.sh`. Check with `.claude/agents/scripts/check-commit-gate.sh --only table` and `--only check`.
- C · proof · stages 4–5 → the calling session builds the copy, runs the three headless sessions, then edits `.claude/settings.json` and `.claude/agents/README.md`. Check with `check-commit-gate.sh`, `check-guards.sh`, `check-agents.sh` and the `guard-pr.sh --check` pair.
- D · proof · stage 6 → the calling session runs the caught-case session, writes the extract outside the tree and removes the copy.
- E · docs · stage 7 → the calling session measures; then to `doc-writer`: "Document the commit gate from `specs/2026-10-12-commit-test-gate.md`, stage 7 of `specs/2026-10-12-commit-test-gate-plan.md`, the code in `.claude/agents/scripts/commit-gate.sh` and `commit-check.sh`, the extract at `<EVID>/caught-case-extract.md` and these measured durations: <lines>. Write only `docs/commit-gate.md`, one line in `docs/README.md` § Contents and one Read-when line in root `AGENTS.md`."
- F · eval · stage 8 → the calling session runs `cd evals && pnpm eval:workflow` once and reports.

multi-agent: not applicable — no two tracks are independent.

## 10. Recommendations — not applied

- REC1 [requirements] Leave documentation-only paths inside a package (`<package>/specs/**`, `<package>/docs/**`, `*.md`) out of "touched". Why: at the base the only uncommitted changes under `server/` and `client/` are spec files, and by the spec's definition (spec:47-48) a session's commit of them needs both suites green — minutes of tests for a Markdown edit. Would change: `cg_touched_packages`, the AC-10 rows, the definition and AC-10 in a superseding spec. Recommended decision: not now.
- REC2 [approach] Close the fail-open paths of the shared code in a separate change: the node branch of `lib_payload_field` passes an invalid payload (`guard-lib.sh:157`), `guard-lib.sh:10` allows when no root resolves, and `guard-pr.sh` allows without `jq` (`:26-31`) and takes its override from any substring (`:41`; DR-3, DR-4). Why: the commit gate carries its own reader because of them, and the PR gate keeps both defects. Would change: `guard-lib.sh`, `guard-pr.sh`, rows in `guard-cases.tsv`; outside this spec (NG-6, NG-7). Recommended decision: not now.
- REC3 [scope] Run `check-commit-gate.sh` and `check-guards.sh` in a CI lane. Why: no workflow under `.github/workflows/` references either, so a later edit of the gate is proven only when someone remembers the runner. Would change: one workflow file, no stage of this plan. Recommended decision: not now.
