# Spec: Commit test gate
Spec ID: SPEC-07
Status: implemented
Supersedes: none

## Problem and user

A **developer of this repository who lets a Claude Code session commit** has no guarantee
that the commit holds green tests. The rule "do not commit without green tests" is written
nowhere a machine enforces it: a session reads it as text, and text is followed most of the
time, not always (IN-1). The course states the difference in so many words: an eval is a
probabilistic check with a threshold, a hook is the rung that holds every time (IN-1), and
of the hook kinds only a command hook decides mechanically — a prompt hook hands the
decision back to the model (IN-3).

A **coding agent** (the main session, or a subagent that no agent guard restricts) is the
other party: today nothing tells it, at the moment it types `git commit`, that a package it
changed is red or was never checked.

What exists today, read at 1d4e77f:

- `.claude/settings.json` registers one project hook, `PreToolUse` on `Bash`, a command hook
  that refuses `gh pr create` / `gh pr ready` without a fresh `pr-self-review` verdict
  (IN-4, IN-5). Nothing gates a commit.
- The project agents that run under an agent guard (`implementer-guard.sh`, `readonly-guard.sh`,
  `write-scope-guard.sh`) are already denied `git commit` outright (IN-6, IN-9). A commit can
  therefore be attempted only by the main session, by a built-in subagent, or by `researcher`,
  which has no guard.
- `.claude/agents/scripts/check-code.sh <package>` is the one command for "does it still
  hold" in `server`, `client`, `reviewer-core` and `mcp` (IN-9, IN-10). Tests may be run
  without asking and cannot reach the dev database (IN-11).

**Who the gate reaches.** A `PreToolUse` hook runs inside Claude Code only. The owner of this
repository forbids Claude, by a personal rule, to run `git commit` at all and commits by hand
in a terminal, where no such hook runs (IN-7). In that developer's sessions the gate fires
only when a session attempts a commit against that rule, and never on the developer's own
commits. The gate is still defined for every developer of the repository: project hooks must
behave the same whatever a developer's personal `~/.claude` settings are (IN-9), and another
developer may let sessions commit.

**Terms used below.**

- *Commit command* — a Bash command with `git` in command position whose subcommand is
  `commit` (the forms are listed in AC-3).
- *Testable package* — `server`, `client`, `reviewer-core`, `mcp`: the four that
  `check-code.sh` accepts (IN-10).
- *Touched package* — a testable package with at least one uncommitted change under its
  folder: staged, unstaged, or untracked and not ignored (IN-13).
- *Green* — every step `check-code.sh` runs for the package without `--it` ended `ok`:
  typecheck, layering where the package has a config, and the tests, for `server` the unit
  lane only (IN-13).
- *Stamp* — the record the test check writes after a green run; *fresh* — no file content
  under a touched package's folder changed since it was written.

## Goals / Non-goals

- **G-1** A commit command issued by a Claude Code session is refused, by code and without a model, unless the tests of every touched package are proven green for the content being committed.
- **G-2** A refused session learns from the refusal what is missing and has one command that produces the proof, so the way forward is to make the tree green and retry.
- **G-3** Everything that is not a commit command passes untouched, including a command that only mentions a commit and the work of changing the gate itself.
- **G-4** An explicit instruction of the developer bypasses the gate, visibly.
- **G-5** One really caught case is on record: what the agent tried to do and what stopped it.
- **NG-1** A git `pre-commit` hook, and with it any gating of a commit typed in a terminal outside Claude Code — the homework asks for one `PreToolUse` hook (IN-1); the wider gate was proposed and rejected (DR-7).
- **NG-2** Running tests, a typecheck or an install inside the hook — the hook has a timeout and a suite has no recorded duration to fit it (DR-6).
- **NG-3** Gating other commands that write history (`git merge`, `git cherry-pick`, `git revert`, `git rebase`, `git am`, `git commit-tree`, `gh pr merge`) or `git push` — the task names a commit, and the template's push gate is a different rule.
- **NG-4** The server integration lane, browser e2e and the harness evals as part of green — they need Docker, the stack or a paid model.
- **NG-5** Stopping a session that deliberately evades the gate: a stamp written by hand, a commit hidden in `bash -c`, an alias or a script file — these are documented limits (IN-13), and a deterministic match over command text is exact, not complete (IN-3).
- **NG-6** Changing what the project agents are allowed to do — the agent guards keep denying `git commit` to them (IN-6, IN-9).
- **NG-7** Replacing or changing the `gh pr create` gate — it stays the gate before a pull request (IN-5).

## User stories

- **US-1** As a developer who lets a Claude Code session commit, I want a commit refused while the touched packages are not proven green, so that a red tree never enters history through an agent.
- **US-2** As a coding agent stopped by the gate, I want the refusal to say what is missing and which command proves it, so that I fix the tree and retry instead of working around the gate.
- **US-3** As a coding agent, I want one command that checks the touched packages and records a green result, so that the commit I attempt afterwards passes.
- **US-4** As a developer, I want commands that are not a commit and commits the gate has no check for to pass, so that the gate never blocks work it has nothing to say about.
- **US-5** As a developer, I want to bypass the gate by an explicit instruction, so that I am not locked out when a package cannot be tested.
- **US-6** As a developer who hands in the homework, I want one caught case recorded with its evidence, so that a reader sees the gate stop a real session.
- **US-7** As a developer of the harness, I want every decision of the gate checkable from a table without a real commit, so that a change to the gate is proven before it is trusted.

## Acceptance criteria (EARS)

- **AC-1** [unwanted] IF a Bash tool call carries a commit command and at least one touched package is not named green by a fresh stamp, THEN the commit gate shall exit with code 2 — covers: US-1 · verify: unit — deny rows of the case table: no stamp, and a stamp that names another package
- **AC-2** [event-driven] WHEN a Bash tool call carries a commit command and every touched package is named green by a fresh stamp, the commit gate shall exit with code 0 — covers: US-1 · verify: unit — an allow row of the case table with a fresh stamp for each touched package
- **AC-3** [ubiquitous] The commit gate shall recognise as a commit command each of these forms with `git` in command position: `git commit` with any flags (`-a`, `--amend`, `-m`, `--dry-run`), `git -C <dir> commit`, `git -c <key>=<value> commit`, a leading `VAR=value` assignment, a leading `env`, `sudo`, `command`, `time`, `nohup` or `exec`, a position after `;`, `&&`, `||`, a pipe, `(`, a backtick or `$(`, and the start of any line of a multi-line command, a heredoc body included — covers: US-1 · verify: unit — one deny row per form, with no stamp
- **AC-4** [unwanted] IF a Bash command holds the text of a commit command only inside a quoted argument, as in `echo "git commit -m x"`, `grep -n 'git commit' AGENTS.md` or the gate's own check mode given a commit command, THEN the commit gate shall exit with code 0 — covers: US-4 · verify: unit — allow rows with no stamp, one per example
- **AC-5** [event-driven] WHEN a Bash tool call carries no commit command, the commit gate shall exit with code 0 whatever the stamp says — covers: US-4 · verify: unit — allow rows with no stamp: `git status --short`, `git add -A`, `git log --oneline -5`, a test run
- **AC-6** [unwanted] IF a commit command stands in command position between quoted texts of mixed kinds, as in `echo "it's" ; git commit -m x ; echo 'y'`, THEN the commit gate shall decide the call as a commit command — covers: US-1 · verify: unit — a deny row with that command and no stamp
- **AC-7** [unwanted] IF the content of a file under a touched package's folder differs from the content the stamp was made for, THEN the commit gate shall exit with code 2 on a commit command — covers: US-1 · verify: unit — a deny row: a stamp is written, one file of the package is changed, the commit command is checked
- **AC-8** [event-driven] WHEN files are staged with `git add` after the stamp was written and no file content changed, the commit gate shall exit with code 0 on a commit command — covers: US-3 · verify: unit — an allow row: a stamp is written, the change is staged, the commit command is checked
- **AC-9** [unwanted] IF the stamp is not readable as the record the test check writes or lacks one of its fields, THEN the commit gate shall exit with code 2 on a commit command of a tree with a touched package — covers: US-1 · verify: unit — deny rows with an empty file, a truncated record and a record without its package list
- **AC-10** [event-driven] WHEN a commit command arrives and no package is touched, because only paths outside `server/`, `client/`, `reviewer-core/` and `mcp/` changed or nothing is uncommitted, the commit gate shall exit with code 0 — covers: US-4 · verify: unit — allow rows with no stamp: a change under `specs/` only, a change under `.claude/` only, and a clean tree with `git commit --amend -m x`
- **AC-11** [event-driven] WHEN the commit gate refuses a commit command, the commit gate shall write to stderr the reason (no stamp, a stale stamp, or the packages not named green), the command that runs the test check for those packages, and the rule that the override is for an explicit instruction of the developer only — covers: US-2 · verify: unit — the stderr of each deny row holds the reason, the test-check command and the override rule
- **AC-12** [event-driven] WHEN the test check is started without a package argument, the test check shall run, for every touched package, the steps that `.claude/agents/scripts/check-code.sh <package>` runs without `--it` — covers: US-3 · verify: unit — with a stand-in for `check-code.sh`, the packages it receives equal the touched packages of a throwaway repository
- **AC-13** [event-driven] WHEN every step of every checked package ends `ok`, the test check shall write a stamp that names those packages green for the current file content — covers: US-3 · verify: unit — after a stand-in run that exits 0, the commit command is allowed through check mode
- **AC-14** [unwanted] IF a step of a package ends `FAIL`, its tests step ends `SKIP`, or `check-code.sh` exits with code 3, THEN the test check shall exit non-zero and leave no stamp that names that package green — covers: US-3 · verify: unit — after a stand-in run for each of the three outcomes, the exit code is non-zero and the commit command is refused through check mode
- **AC-15** [ubiquitous] The test check shall print the line per step and the failure excerpts that `check-code.sh` prints — covers: US-3 · verify: unit — the output of a failing stand-in run holds its `FAIL` line and its excerpt
- **AC-16** [ubiquitous] The test check shall keep the stamp where `git status --short` does not list it — covers: US-3 · verify: unit — `git status --short` prints the same lines before and after a green run
- **AC-17** [optional] WHERE `COMMIT_GATE_OVERRIDE=1` is set in the environment of the hook or stands as an assignment in command position before the commit command, the commit gate shall exit with code 0 after writing one bypass line to stderr — covers: US-5 · verify: unit — allow rows with no stamp, one per place, and the bypass line on stderr
- **AC-18** [unwanted] IF the override assignment stands only inside a quoted argument, such as a commit message, THEN the commit gate shall decide the command as if no override were set — covers: US-5 · verify: unit — a deny row: no stamp, the assignment inside the `-m` text
- **AC-19** [unwanted] IF neither `jq` nor `node` is on `PATH` in hook mode, THEN the commit gate shall exit with code 2 and name the missing tools on stderr — covers: US-1 · verify: unit — a hook-mode run with a `PATH` that holds neither, payload on stdin
- **AC-20** [unwanted] IF an internal step of the commit gate fails or the hook payload is not valid JSON, THEN the commit gate shall exit with code 2 and never with code 1 — covers: US-1 · verify: unit — hook-mode runs with a payload that is not JSON and with `git` absent from `PATH`
- **AC-21** [event-driven] WHEN the commit gate is started in check mode with a command text as its argument, the commit gate shall return the exit code that hook mode returns for a payload carrying that command, without reading stdin — covers: US-7 · verify: unit — the same command through both modes, for one allow row and one deny row
- **AC-22** [ubiquitous] The case table of the commit gate shall hold at least one allow row and one deny row for every rule of AC-3 to AC-10, AC-17 and AC-18, each run through check mode against a throwaway repository state — covers: US-7 · verify: unit — the table's runner reports every row matching and no row typing a real commit in the working copy
- **AC-23** [ubiquitous] The project settings file `.claude/settings.json` shall register the commit gate as a `PreToolUse` hook of `type: "command"` for the `Bash` tool — covers: US-1 · verify: unit — the parsed settings hold that entry beside the existing `guard-pr.sh` entry
- **AC-24** [ubiquitous] The commit-gate document under the repository's docs folder shall hold one caught-case record with these fields: the date; who attempted the commit (the main session or a named agent) and on which task; the command as it was attempted; what was red (the package, the failing step, the failing test); the refusal text as the gate printed it; what the session did next; where the evidence is (the session and its transcript); and whether the attempt was provoked or unprompted — covers: US-6 · verify: manual — evidence of one real session, which no test produces; the reader compares the record with the transcript it names
- **AC-25** [ubiquitous] The caught-case record shall quote a refusal that the commit gate produced in hook mode, in a Claude Code session that was started after the gate was registered, works on a throwaway copy of the repository and has no agent guard denying its `git commit` — covers: US-6 · verify: manual — a real session is the evidence and no test produces one; the refusal text is found in the named transcript as a hook result, not as the output of check mode
- **AC-26** [ubiquitous] The root `AGENTS.md` shall link the commit-gate document under its Read-when list, with the trigger that makes a reader open it — covers: US-6 · verify: manual — a reading of the Read-when list; no suite checks instruction files for links
- **AC-27** [event-driven] WHEN a commit command names another directory with `-C <dir>`, the commit gate shall judge the touched packages and the stamp of the project's own working copy — covers: US-1 · verify: unit — a deny row with `git -C <dir> commit -m x` and no stamp, and an allow row with a fresh stamp
- **AC-28** [unwanted] IF the commit gate has not returned within the timeout its hook entry declares, THEN the hook entry of the commit gate shall make Claude Code refuse the tool call by declaring `onFailure: "block"` [NEEDS CLARIFICATION: documented, not proven on the installed version → OQ-11] — covers: US-1 · verify: manual — needs a real Claude Code session: a throwaway hook entry with that field outlasts a short timeout and the Bash call is seen refused, once, before the gate is described as failing closed on a timeout

## Edge cases

- **EC-1** No stamp was ever written in this working copy → the commit is refused and the refusal names the test check — covered by: AC-1, AC-11
- **EC-2** A file of a touched package is edited after a green check → the stamp is stale and the commit is refused — covered by: AC-7
- **EC-3** The session runs the test check, then `git add`, then the commit → allowed, although staging is exactly what makes a `pr-self-review` verdict stale (DR-5) — covered by: AC-8
- **EC-4** Only part of the working copy is staged, so the tree being committed differs from the tree the tests ran on → the gate judges the file content of the working copy whatever part of it is staged; the difference is a documented limit — covered by: AC-7, AC-8
- **EC-5** A commit of documents or specs only → allowed without a stamp — covered by: AC-10
- **EC-6** `git commit --amend` that changes only the message, on a clean tree → allowed without a stamp — covered by: AC-10
- **EC-7** `git commit -a` or `git commit --amend` with a touched package → judged as any other commit command — covered by: AC-3
- **EC-8** `git commit --dry-run` → gated like a real commit — covered by: AC-3
- **EC-9** A line of a heredoc body begins with `git commit` → refused without a fresh stamp, as `guard-pr.sh` refuses the equal case because its match is line-based (IN-8); a documented limit — covered by: AC-3
- **EC-10** The commit is hidden from the command text: `bash -c 'git commit'`, a git alias, a script file, `eval` → the gate sees no commit command and lets the call run; a documented limit — covered by: AC-5
- **EC-11** Another history-writing command creates the commit: `git merge`, `git cherry-pick`, `git revert`, `git rebase --continue`, `git am` → not a commit command, the call runs — covered by: AC-5
- **EC-12** `git -C <dir> commit` points at a working copy other than the project's → judged against the project's working copy — covered by: AC-27
- **EC-13** The dependencies of a touched package are not installed, so `check-code.sh` reports `FAIL … is missing` → no stamp, the commit is refused, the override is the way out — covered by: AC-14
- **EC-14** A tests step ends `SKIP` with exit code 0 because no test executed → the package is not green — covered by: AC-14
- **EC-15** `reviewer-core` is touched → the test check runs what `check-code.sh reviewer-core` runs, the server typecheck included and the server tests not — covered by: AC-12
- **EC-16** Only `.claude/`, `evals/`, `e2e/` or `scripts/` changed: each has checks of its own (`check-guards.sh`, `check-agents.sh`, `pnpm eval:quality`) that `check-code.sh` does not run → the commit passes without a stamp — covered by: AC-10
- **EC-17** One Bash call chains the test check and the commit → the hook runs before the call, finds no fresh stamp and refuses the whole call; the session runs the two as separate calls — covered by: AC-1
- **EC-18** One Bash call changes a file and commits it (`sed -i … && git commit`) → the gate judges the state before the call and does not see the change: with a fresh stamp the call runs; a documented limit — covered by: AC-2
- **EC-19** Neither `jq` nor `node` is installed → every Bash call of the session is refused, not only a commit — covered by: AC-19
- **EC-20** The stamp holds a `false` where a reader written with jq's `//` would see an empty value → the read keeps `false` and `true` apart, in the allow path as well as in the deny path — covered by: AC-9, AC-22
- **EC-21** A project agent under an agent guard attempts a commit → its own guard denies it as today and the gate fires as well, so such an attempt does not show the gate stopping anything — covered by: AC-25
- **EC-22** The hook runs longer than the timeout its entry declares → by the documentation the tool call is not blocked and continues through the normal permission flow, unless the entry sets `onFailure: "block"` (IN-14); that field is not proven on the installed version — open: OQ-11
- **EC-23** A session was started before the gate was registered → by the documentation it reloads the settings file and runs the new hook (IN-14); the caught case is still taken from a session started afterwards — covered by: AC-25
- **EC-24** The override assignment appears inside the commit message → no bypass — covered by: AC-18
- **EC-25** The developer commits in a terminal outside Claude Code → no `PreToolUse` hook runs and the commit is not gated; a git `pre-commit` hook was proposed and rejected (DR-7) — covered by: AC-23

## Non-functional requirements

- **NFR-1** [cost] The commit gate and the test check make no model call: the hook entry is `type: "command"`, neither `type: "prompt"` nor `type: "agent"` — verify: reading the hook entry in `.claude/settings.json`
- **NFR-2** [performance] The commit gate starts no typecheck, no layering check, no test runner and no install at hook time — verify: the case table passes in a throwaway repository that has no `node_modules`
- **NFR-3** [performance] The hook entry of the commit gate declares a timeout of 20 s, the value of the existing `Bash` hook entry and a choice below the documented default of 600 s for a `command` hook (IN-13, IN-14) — verify: reading the hook entry in `.claude/settings.json`
- **NFR-4** [compatibility] The existing hook entry for `.claude/skills/pr-self-review/scripts/guard-pr.sh` stays registered and returns the exit codes it returns today, and `.claude/agents/scripts/check-guards.sh` and `.claude/agents/scripts/check-agents.sh` pass — verify: both scripts, and `guard-pr.sh --check` on one allow and one deny command before and after the change
- **NFR-5** [compatibility] The commit gate and the test check read nothing under `~/.claude`, are registered in the tracked `.claude/settings.json` and not in a developer's local settings file, and need only `bash`, `git`, and `jq` or `node` — verify: a hook-mode run with `HOME` set to an empty directory returns the exit codes of the case table
- **NFR-6** [security] The command text of the hook payload and the content of the stamp are read as data: neither is evaluated, sourced or executed — verify: case-table rows whose command holds `$(touch <probe>)` and a backtick form leave no probe file
- **NFR-7** [observability] Every refusal and every bypass writes to stderr a line that begins with the gate's name — verify: the stderr captured by the case table
- **NFR-8** [compatibility] After the change to `.claude/settings.json` and to `AGENTS.md`, the workflow eval suite (`pnpm eval:workflow` in `evals/`) passes — verify: one run of that suite, which starts model sessions on the Claude Code subscription

## Module interactions

Packages: tooling
Surfaces: the commit gate (a `PreToolUse` command hook for the `Bash` tool, registered in `.claude/settings.json`, with a check mode); the test check (a command a session runs before a commit); the stamp (a git-ignored record in the working copy); the commit gate's case table; the commit-gate document with the caught-case record

| # | From → To | Channel | Carries | Exists today | If it fails |
|---|---|---|---|---|---|
| MI-1 | Claude Code → the commit gate | the `PreToolUse` hook call, payload as JSON on stdin | the tool name and the Bash command text | changes (`.claude/settings.json:3` — one entry today, for `guard-pr.sh`) | a payload that is not JSON refuses the call (AC-20) |
| MI-2 | the commit gate → Claude Code | exit code and stderr | 0 lets the call run; 2 refuses it and hands stderr to the session | new | exit code 1 would let the call run (IN-8), so every failure becomes 2 (AC-20) |
| MI-3 | a session → the test check | a Bash command | optionally the packages to check; by default the touched packages | new | non-zero exit and no green stamp for the failed package (AC-14) |
| MI-4 | the test check → `check-code.sh` | a process with the package names as arguments | one line per step with `ok`, `FAIL` or `SKIP`, excerpts, exit code 0, 1 or 3 | yes (`.claude/agents/scripts/check-code.sh:100` prints the line, `:150` sets the exit code) | exit 1 or 3, or a `SKIP` line: the package is not green (AC-14) |
| MI-5 | the test check → the commit gate | the stamp in the working copy | when it was written, the content it was made for, the packages that ended green | new | a missing or unreadable stamp refuses a commit of a touched package (AC-1, AC-9) |
| MI-6 | the commit gate → git | read-only git commands | the uncommitted paths and the content of the files under the touched packages | yes (`.claude/skills/pr-self-review/scripts/lib.sh:35` reads the same facts for the verdict) | a failing git call refuses the call (AC-20) |

What each side may rely on:

- The hook sees a tool call before it runs. It judges the working copy as it stands at that
  moment, never what the command would do to it (EC-17, EC-18).
- The stamp is written only by the test check and read only by the commit gate. It carries
  no secret and never leaves the machine.
- The commit gate is one more project hook on the `Bash` tool beside `guard-pr.sh`; agent
  guards declared in an agent's frontmatter run on top of both (IN-9). By the documentation
  every matching hook runs, in parallel, and hooks from the settings file also run for the
  tool calls of subagents (IN-14). The commit gate therefore relies on no other hook having
  run first. That one hook's exit code 2 refuses the call while another hook allows it is
  inferred from the documentation, not quoted from it; the caught case of AC-25 is the first
  observation of it here.
- The hook entry uses the matcher `Bash` and the gate matches the command text itself. By the
  documentation a matcher filters on the tool name only, so the template's `Bash(git push*)`
  would be read as a pattern over the tool name; that it never matches is inferred (IN-14).
- `implementer-guard.sh` refuses an agent's edit of `.claude/settings.json`, of the local
  settings file beside it and of everything under `.claude/agents/scripts/` (IN-6): the hook
  settings are changed by the developer or the calling session, not by an `implementer`.

## Design review

Sources reviewed: IN-2, IN-3, IN-4, IN-5, IN-6, IN-8, IN-10

| # | Kind | Finding | Proposal | Decision |
|---|---|---|---|---|
| DR-1 | inconsistency | The template's example (IN-2) is `type: "prompt"` with the matcher `Bash(git push*)`: it asks the model to run a review and to hold the push back. IN-3 says a prompt hook's result stays probabilistic and that a hard gate needs a command hook; IN-1 calls the task a deterministic gate | Take the event and the place from the template (`PreToolUse`, `.claude/settings.json`) and the handler type from IN-3 and from the repository's own hook (IN-4) | accepted → AC-23, NFR-1 |
| DR-2 | inconsistency | IN-1 says two ready examples lie in the template. One was found: the same single entry on `base/Lesson-06-lab-finish`, `base/evals-example` and `base/lesson-7-lab/multiagents-finish`. `base/l06-evals`, `base/full-functionality`, `base/main` and `base/reference/full-build` hold no `.claude/settings.json` and no hooks folder | Model the gate on the one template entry and on the repository's own command hook (IN-5) | accepted → AC-23 |
| DR-3 | corner case | `.claude/skills/pr-self-review/scripts/guard-pr.sh:41` accepts its override when the text stands anywhere in the command, a commit message or an `echo` included; IN-7 and IN-8 require command position and never a bare substring | Read the override only from the hook's environment or from an assignment in command position | accepted → AC-18 |
| DR-4 | corner case | `.claude/skills/pr-self-review/scripts/guard-pr.sh:26` reads the command with `jq` only and exits 0 when `jq` is absent (`:31`), so that gate fails open; IN-7 requires failing closed without `jq` and `node` | Read the payload with `jq` or `node` and refuse the call when neither is there | accepted → AC-19 |
| DR-5 | module | The `pr-self-review` verdict is bound to the index as well as to the files (`.claude/skills/pr-self-review/scripts/lib.sh:35`), so `git add` alone makes it stale (IN-8, entry of 2026-10-06). Before a commit, staging is the step between the tests and the commit | Bind the stamp to file content only, so staging leaves it fresh | accepted → AC-8 |
| DR-6 | module | Two ways to prove green. Tests at hook time: nothing to forget, but the existing hook entry allows 20 s (`.claude/settings.json:10`), `check-code.sh` runs two or three steps per package one after another (IN-10), a single server test may take 120 s (`server/vitest.config.ts:20`), no duration of a whole suite is recorded anywhere in the repository, and by the documentation a timed-out command hook does not block the call (IN-14). A stamp: the hook only compares, in a time that does not grow with the suites, and the repository already gates a pull request this way (IN-5) | Use a stamp written by a separate test check | accepted → NFR-2 |
| DR-7 | ux | The gate never fires on a commit the developer types in a terminal, which is how the owner of this repository commits (IN-7) | Add a git `pre-commit` hook that runs the same comparison | rejected — the user, 2026-10-12 (IN-13): the homework asks for a `PreToolUse` hook, and a git hook needs an install step in every clone |
| DR-8 | module | A commit that touches only `.claude/`, `evals/` or `scripts/` has checks of its own (`.claude/agents/scripts/check-guards.sh`, `.claude/agents/scripts/check-agents.sh`, `pnpm eval:quality`) that `check-code.sh` does not run, so it would pass ungated | Count the tooling as a checked area with those three commands | rejected — the user, 2026-10-12 (IN-13): a commit that touches no testable package passes without a stamp (AC-10) |
| DR-9 | ux | A session learns of the gate only when it is refused | Add one line to root `AGENTS.md` § Conventions that names the test check as the step before a commit | rejected — the user, 2026-10-12 (IN-13): the refusal text is where a session learns the step (AC-11) |

DR-1, DR-3 and DR-4 are settled by the sources named in their rows; DR-2, DR-5 and DR-6 were
accepted and DR-7, DR-8 and DR-9 rejected by the user (IN-13).

## Inputs and provenance

| # | Source | Kind | Used for |
|---|---|---|---|
| IN-1 | `course-materials/materials/lesson6/hw6_description.txt:104-110`, the task in the user's words: «PreToolUse hook — детермінований гейт у harness. Проблема, яку воно розв'язує. Евал — ймовірнісна перевірка з порогом, а деякі правила мають виконуватися завжди: наприклад, «не комітити без зелених тестів». Для таких правил існують hooks — гарантований щабель драбини надійності з L02. Що конкретно треба зробити. Один PreToolUse-hook у .claude/settings.json — тест-гейт перед комітом. Два готові приклади лежать у template: прочитайте їх, свій напишіть за зразком. Попрацюйте кілька сесій і задокументуйте один реально зловлений випадок — що агент намагався зробити і що його зупинило. Ключова ідея: ймовірнісне міряємо евалами, критичне блокуємо hook'ом — це дві різні відповіді на два різні класи правил.» | user text | Problem, G-1, G-5, NG-1, US-1, US-6, DR-1, DR-2 |
| IN-2 | `git show base/Lesson-06-lab-finish:.claude/settings.json` — the course template's hook: one `PreToolUse` entry, matcher `Bash(git push*)`, `type: "prompt"`; the same file on `base/evals-example` and `base/lesson-7-lab/multiagents-finish` | repository | DR-1, DR-2 |
| IN-3 | `course-materials/materials/lesson6/lab6_description.txt:191-200`: «command hook може детерміновано дозволити або заблокувати tool call через exit code чи structured decision; prompt hook передає рішення моделі, тому його результат лишається ймовірнісним … Для правила «не виконувати git push, якщо тести падають» потрібен command hook, який сам запускає фіксовану команду перевірки й повертає deny … Детермінованість виконання не дорівнює безпомилковості специфікації.» | repository | Problem, NFR-1, AC-23, NG-5, DR-1 |
| IN-4 | `.claude/settings.json` @ 1d4e77f | code | Problem, MI-1, NFR-3, NFR-4 |
| IN-5 | `.claude/skills/pr-self-review/scripts/guard-pr.sh`, `.claude/skills/pr-self-review/scripts/lib.sh`, `.claude/skills/pr-self-review/scripts/write-verdict.sh` @ 1d4e77f; `.gitignore:28` | code | AC-11, AC-16, AC-21, NG-7, US-2, US-5, G-4, MI-6, DR-3, DR-4, DR-5 |
| IN-6 | `.claude/agents/scripts/guard-lib.sh`, `.claude/agents/scripts/implementer-guard.sh`, `.claude/agents/scripts/check-guards.sh` and the first 60 rows of `.claude/agents/scripts/guard-cases.tsv` @ 1d4e77f | code | AC-3, NFR-6, NFR-7, NG-6, EC-21, Module interactions |
| IN-7 | the calling session's task text, 2026-10-12: the gate fires only on a commit attempted by an agent or a session, because the user's personal rule forbids Claude to commit and the user commits by hand; it is defined for every developer; no git `pre-commit` hook unless raised as a proposal; the forms to settle (`git commit`, `-a`, `--amend`, `git -C <dir> commit`, env prefixes), the override, docs-only commits, a package that cannot be tested; the binding constraints from `INSIGHTS.md`; verification through a table of allow and deny commands | user text | Problem, G-3, NG-1, US-4, US-7, AC-4, AC-18, AC-19, AC-20, AC-22, NFR-5, EC-2, EC-5, EC-6, EC-7, EC-19 |
| IN-8 | `INSIGHTS.md` @ 1d4e77f, § What Doesn't Work (regex quote stripping; exit 1 allows and `block` in a subshell; the heredoc line; the bare substring) and § Tool & Library Notes (`jq` `//` and `false`; the verdict tied to the index; frontmatter hooks and workspace trust; `permissionMode` is not a guard) | repository | AC-6, AC-9, EC-3, EC-9, EC-20, MI-2, DR-5 |
| IN-9 | `.claude/agents/README.md` § Shared contracts (Self-containment, Tests, Verification) and § Guards @ 1d4e77f | repository | Problem, NG-6, NFR-5, Module interactions |
| IN-10 | `.claude/agents/scripts/check-code.sh` @ 1d4e77f | code | AC-12, AC-14, AC-15, EC-13, EC-14, EC-15, MI-4, DR-6 |
| IN-11 | root `AGENTS.md` (§ Commands, § Harness evals, § Conventions) and `TESTING.md` (§ Suite map, § What each suite covers) @ 1d4e77f | repository | Problem, NFR-8, NG-4 |
| IN-12 | `docs/README.md` § Rules and `docs/retro/README.md` @ 1d4e77f | repository | AC-24, AC-26 |
| IN-13 | answers, 2026-10-12, relayed by the calling session: the user chose «Бери рекомендовані сам» — every recommended option of the thirteen questions as written in the draft; for the caught case the approval is given: it is provoked by the calling session in a fresh session on a throwaway copy and recorded as provoked; the proposals DR-7, DR-8 and DR-9 are rejected | user answer | Terms, G-2, NG-2…NG-5, US-3, AC-1, AC-2, AC-7, AC-8, AC-10, AC-12, AC-13, AC-14, AC-17, AC-24…AC-27, NFR-2, NFR-3, EC-4, EC-8…EC-12, EC-16, EC-18, EC-25, DR-2, DR-5…DR-9 |
| IN-14 | researcher report, 2026-10-12: https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/settings — unversioned pages, the installed version was not checked. Quoted: the default timeout is 600 s for a `command` hook; «A timed-out `command`, `http`, or `mcp_tool` hook doesn't block the tool call … To block the call when a `command` or `http` hook times out, set `onFailure: "block"`»; settings files are watched and reloaded, `hooks` included; hooks from settings files also run inside subagents; all matching hooks run in parallel and exit code 2 blocks. Inferred by the report, not quoted: `Bash(git push*)` as a matcher never matches; either of two hooks blocks alone. Not confirmed: `onFailure` against a schema or the installed version. Not found: a maximum timeout; an exception behind «normally picked up»; whether the stderr of two blocking hooks is merged | research | NFR-3, AC-28, EC-22, EC-23, DR-1, DR-6, Module interactions |

| Items | Origin | Source |
|---|---|---|
| G-1, G-5, US-1, US-6, EC-1 | stated | IN-1 |
| G-3, NG-1, US-4, US-7, AC-4, AC-18, AC-19, AC-20, AC-22, NFR-5, EC-2, EC-5, EC-6, EC-7, EC-19 | stated | IN-7 |
| AC-23, NFR-1 | stated | IN-1, IN-3 |
| AC-6, AC-9, EC-3, EC-20 | code | IN-8 |
| G-4, NG-7, US-2, US-5, AC-11, AC-16, AC-21, EC-17, EC-24 | code | IN-5 |
| NG-6, AC-3, AC-5, NFR-6, NFR-7, EC-21 | code | IN-6 |
| AC-15, EC-13, EC-14, EC-15 | code | IN-10 |
| NFR-4 | code | IN-4 |
| NFR-8 | code | IN-11 |
| G-2, NG-2…NG-5, US-3, AC-1, AC-2, AC-7, AC-8, AC-10, AC-12, AC-13, AC-14, AC-17, AC-24…AC-27, NFR-2, NFR-3, EC-4, EC-8…EC-12, EC-16, EC-18, EC-25 | stated | IN-13 |
| EC-23 | research | IN-14 |
| AC-28, EC-22 | assumed | OQ-11 |

Not found: a second ready hook example in the course template (DR-2); a recorded duration of
any test suite or of `check-code.sh` (DR-6); a proof that `onFailure: "block"` is honoured by
the installed Claude Code (OQ-11). No instruction was found inside a source.

## Untrusted inputs

| # | Input | Controlled by | Enters at | Reaches | Rule |
|---|---|---|---|---|---|
| UI-1 | The Bash command text in the hook payload | the session's model, and through it any text the session has read: repository files, pull-request text, tool results | the hook's stdin | a shell process: the gate's matching of the text | read as text only, never evaluated, sourced or executed — NFR-6; a payload that is not JSON refuses the call — AC-20 |
| UI-2 | The stamp | any process with write access to the working copy, the session's own file tools included | the working copy | the gate's decision to let a commit run | parsed as data, never executed — NFR-6; an unreadable or incomplete one refuses the commit — AC-9; a stamp written by hand is not detected, a documented limit (NG-5) |

## Traceability

| Goal | Stories | Criteria | Edge cases | NFR |
|---|---|---|---|---|
| G-1 | US-1 | AC-1, AC-2, AC-3, AC-6, AC-7, AC-9, AC-19, AC-20, AC-23, AC-27, AC-28 | EC-1, EC-2, EC-7, EC-19, EC-20 | NFR-1, NFR-2, NFR-3 |
| G-2 | US-2, US-3 | AC-8, AC-11…AC-16 | EC-3, EC-13, EC-14, EC-15, EC-17 | — |
| G-3 | US-4, US-7 | AC-4, AC-5, AC-10, AC-21, AC-22 | EC-5, EC-6, EC-9 | NFR-4, NFR-6 |
| G-4 | US-5 | AC-17, AC-18 | EC-24 | NFR-7 |
| G-5 | US-6 | AC-24…AC-26 | EC-21, EC-23 | — |
| — | — | — | EC-4, EC-8, EC-10, EC-11, EC-12, EC-16, EC-18, EC-22, EC-25 | NFR-5, NFR-8 |

## Open questions

- **OQ-11** [non-blocking] Does `onFailure: "block"` on a `command` hook entry make the installed Claude Code refuse the tool call when the hook runs past its timeout? The documentation says so (IN-14); the report did not confirm the field against a schema or the installed version, and without it a timed-out gate lets the commit through — options: declare the field and prove it once in a real session with a throwaway hook entry that outlasts a short timeout, before the gate is described as failing closed on a timeout / leave the field out and record in the commit-gate document that a timed-out gate lets the commit through / have `researcher` or the calling session read the installed version's settings schema first — default taken: declare the field and prove it with a throwaway hook entry; until that proof exists the commit-gate document says that a timed-out gate lets the commit through — affects: AC-28, EC-22, NFR-3
