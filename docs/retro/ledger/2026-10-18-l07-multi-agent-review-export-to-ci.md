# Retro: L07 — Multi-Agent Review + Export to CI in two worktrees

Date: 2026-10-18
Run: spec-creator ×2 → implementation-planner ×2 → headless `/implement` per worktree · spec `specs/2026-10-18-multi-agent-review.md`, `specs/2026-10-18-export-to-ci.md` · plan `specs/2026-10-18-multi-agent-review-plan.md`, `specs/2026-10-18-export-to-ci-plan.md` · branch `feature/lab-07` @ `c459009`
Mode: deep
Totals: agents 14 · launches 14 · resumes 0 · fix rounds 0 · question rounds 0 · human prompts 10 · wall 0:39
Tokens: cache read 67.7M · cache write 2.5M · output 543k · cost snapshot $8.44
Units: stages 13 · criteria 121/136 · files changed 155
Outcome: both features merged into `feature/lab-07` A first, B second; server/client/integration/agent-runner checks green; demo PR reviewed in GitHub Actions, CRITICAL blocks merge through a required check, result pulled into CI Runs.

## Launch table

Main session (#1–4, Opus) and one headless `claude -p "/implement …"` session per worktree (#5–9 A, #10–14 B, Sonnet).

| # | Agent | Purpose | Trigger | Shape | ∥ with | Final context | Tool uses | Duration | Outcome |
|---|---|---|---|---|---|---|---|---|---|
| 1 | spec-creator | SPEC-11 Multi-Agent Review | pipeline step | bg | 2 | 221925 | 74 | 12:04 | done, 25 decisions delegated |
| 2 | spec-creator | SPEC-12 Export to CI | pipeline step | bg | 1 | 239379 | 75 | 13:49 | done, 30 decisions delegated, 3 research items |
| 3 | implementation-planner | plan A | pipeline step | bg | 4 | 274851 | 45 | 12:51 | done, 2 questions, 3 recommendations |
| 4 | implementation-planner | plan B | pipeline step | bg | 3 | 281396 | 51 | 12:29 | done, 2 questions, F1/F2 to spec-creator |
| 5 | implementer | A brief 1 shared (stages 1–2) | /implement | bg | — | n/a | n/a | 0:59 | done |
| 6 | implementer | A brief 2 server (3–4) | /implement | bg | 7, 11, 12 | n/a | n/a | 1:44 | done |
| 7 | implementer | A brief 3 client (5–6) | /implement | bg | 6, 11, 12 | n/a | n/a | 3:51 | done |
| 8 | plan-verifier | A verify | /implement | bg | 9 | n/a | n/a | 1:40 | 63 done · 3 partial · 3 deviated (declared) |
| 9 | architecture-reviewer | A review | /implement | bg | 8 | n/a | n/a | 0:50 | 0 findings |
| 10 | implementer | B brief 1 shared (1–2) | /implement | bg | 5 | n/a | n/a | 1:36 | done |
| 11 | implementer | B brief 2 server (3–4) | /implement | bg | 6, 7, 12 | n/a | n/a | 3:42 | done |
| 12 | implementer | B brief 3 client (5–6) | /implement | bg | 6, 7, 11 | n/a | n/a | 3:36 | done |
| 13 | plan-verifier | B verify | /implement | bg | — | n/a | n/a | 1:46 | 58 done · 3 partial · 5 missing (manual / stage 7) · 1 undeclared deviation accepted |
| 14 | architecture-reviewer | B review | /implement | bg | — | n/a | n/a | 1:08 | 2 WARNING, both accepted by plan §8 |

Units: stages 6 (A) + 7 (B, stage 7 done by the calling session); criteria from plan-verifier 63/69 (A) + 58/67 (B); 155 files changed against `main`, 12 951 insertions.

## Measurements

Main session (spec + plan phase, Opus): 345 API calls · cache read 55.3M · output 379k · snapshot $0.94 (see Not established).

| Window | Length | One agent | Agents in parallel | Session alone | Waiting for user |
|---|---|---|---|---|---|
| main 09:30:54 → 09:59:47 UTC | 28m 53s | 2m 42s (9%) | 24m 15s (84%) | 1m 55s (7%) | 0s |
| A headless 10:00:57 → 10:08:37 | 7m 41s | 4m 00s (52%) | 2m 31s (33%) | 1m 09s (15%) | 0s |
| B headless 10:00:57 → 10:10:15 | 9m 17s | 4m 36s (50%) | 3m 36s (39%) | 1m 05s (12%) | 0s |

| Agent type | Agents | API calls | Cache read Σ | Output Σ | Model |
|---|---|---|---|---|---|
| spec-creator | 2 | 117 | 14.8M | 145k | opus-5-5 |
| implementation-planner | 2 | 84 | 14.9M | 152k | opus-5-5 |
| implementer | 6 | 85 | 8.6M | 118k | sonnet-5-5 |
| plan-verifier | 2 | 19 | 1.3M | 21k | sonnet-5-5 |
| architecture-reviewer | 2 | 16 | 1.0M | 14.8k | sonnet-5-5 |

Lab-level numbers (timeline file, DB, git):
- Overlap of the two worktree sessions: 13:00:48 → 13:08:50 local = 8m 02s; spec agents overlapped 12m, planners 12m 29s.
- Wall-clock from the `agent-runner` commit (12:18:30) to a green `feature/lab-07` after B's merge (≈13:29): ≈1h 11m; first agent → last agent end 0:39 (headline).
- Merge conflicts: 1, in the declared shared file `server/src/modules/index.ts`. File overlap of the two worktrees: that one file.
- OpenRouter spend of the whole lab: 7 paid runs, $0.00142 (1-vs-3 measurement $0.00066, merged smoke $0.00057, one CI run $0.00019).
- Claude snapshots: A $3.45, B $4.05, main $0.94 (lagging) → $8.44 recorded.
- Human review time: not measured (see Not established); user rounds caused by the run: 2 token fixes, 1 PR review "Ок", 2 status questions.

## Findings

### calling-session

- F1 [calling-session] friction — Implementers could not be launched from the main session into a worktree: every guard and `check-code.sh` resolve the root from `CLAUDE_PROJECT_DIR`, so writes into `../devdigest-*` count as outside the repository; resolved with one headless `claude -p "/implement …"` per worktree. Evidence: `guard-lib.sh:9`, planner #3 Question 2. Cost: one detour, no rework.
- F2 [calling-session] wrong-claim — The spec briefs repeated the lab text that the `ci/` module, the grouping heuristic and the parallel executor were already built; both spec-creators found them absent and specced them as new work. Evidence: reports of #1 and #2, first section. Cost: none, caught before planning.
- F3 [calling-session] friction — Export answered 502 three times because the studio's fine-grained PAT had no Contents write on the new demo repo; a one-call probe (create a git blob, 201 vs 403) located it once tried. Evidence: wizard error "Resource not accessible by personal access token", API log statuses 502. Cost: 2 user rounds, 3 Install attempts.
- F4 [calling-session] human-load — Two user messages only asked for status while background agents ran or the user's own step was pending. Evidence: user messages "Щось відбувається?" and "А зараз?". Cost: 2 human prompts.

### implementer

- F5 [implementer] miss — The CI Runs page rendered without `AppShell`; verifier #13 and reviewer #14 passed it and no test existed, the calling session caught it from a screenshot after A was merged. Evidence: screenshot of `/ci-runs` without sidebar, fix commit `d40a530`. Cost: one extra commit before B's merge.

### command:implement

- F6 [command:implement] ease — Both builds went through on the first attempt with 0 fix rounds and 6 implementers on Sonnet, helped by §9 brief tables with disjoint write sets and per-stage `Read first:` lists. Evidence: deep windows 7m 41s (A) and 9m 17s (B), reports of both headless sessions. Cost: n/a.

### spec-creator

- F7 [spec-creator] duplication — `check-spec.sh --next-id` gave SPEC-11 to both parallel spec-creators and #2 renumbered only after the full check. Evidence: report of #2 § Insights. Cost: one renumbering.

### implementation-planner

- F8 [implementation-planner] duplication — Each planner read root `INSIGHTS.md` four times. Evidence: deep table "Files read three or more times by one agent". Cost: n/a.
- F9 [implementation-planner] handoff — The planner returns the plan as text, so the calling session extracted about 66 kB per plan from the agent transcript into `specs/*-plan.md`. Evidence: plan sizes 66 234 and 68 069 chars written by the calling session. Cost: two extraction steps; recurring from 2026-10-06 P2.

### skill:pr-self-review

- F10 [skill:pr-self-review] friction — `guard-pr.sh` blocked `gh pr create -R vklyovsa/devdigest-demo` over this repository's stale verdict although the PR targets another repository; the run used the override under the user's standing permission for the demo repo. Evidence: hook message "Вердикт від 2026-10-05 … HEAD зараз 3fcfcb0". Cost: one blocked command.

### script:collect-run

- F11 [script:collect-run] friction — `collect-run.mjs --session` could not find the headless worktree sessions because it derives the project directory from `git rev-parse` of the cwd; it worked only when started inside each worktree. Evidence: "has no transcript in …/-home-klov-emdash-repositories-dev-digest". Cost: one rerun.

## Proposals

First to take: P1 — it removes the detour that decided the shape of the whole run, and two worktrees are the lab's standard setup.

- P1 → `.claude/commands/implement.md` — In § 0 Preflight add: when the plan path lies in another git worktree, stop and print the exact command `cd <worktree> && claude -p "/implement <plan> …"` instead of dispatching implementers whose writes the guards will refuse. From: F1 · Effect: no failed dispatch, the per-worktree session is the documented path · Effort: S · Status: proposed
- P2 → `.claude/agents/implementation-planner.md` — Let the planner write its own `*-plan.md` (Write/Edit under a `plans` write-scope profile) and return path + questions + ≤30-line summary. From: F9 · Effect: ~66 kB per plan stays out of the calling session; no transcript extraction · Effort: M · Status: proposed
- P3 → `.claude/skills/pr-self-review/scripts/guard-pr.sh` — Allow `gh pr create` when `-R/--repo` names a repository other than this checkout's `origin`/`base` remotes; the verdict covers this repository's code only. From: F10 · Effect: no override needed for demo/target repos · Effort: S · Status: proposed
- P4 → `.claude/agents/scripts/check-spec.sh` — Make `--next-id` reserve the id (write a placeholder line to `specs/README.md` atomically) or accept an id from the brief, so parallel spec-creators cannot collide. From: F7 · Effect: no renumbering after parallel specs · Effort: S · Status: proposed
- P5 → `.claude/agents/implementer.md` — For a brief that adds a new route page under `client/src/app/`, the Done-when must include "renders inside `AppShell` like its siblings (`grep -l AppShell` of the sibling page)". From: F5 · Effect: the missing-shell class of bug fails at the implementer, not after merge · Effort: S · Status: proposed
- P6 → `.claude/skills/workflow-retro/scripts/collect-run.mjs` — Add a `--project-dir DIR` option, or search every project folder under `~/.claude/projects` for the session id, so worktree and headless sessions are measurable from the main checkout. From: F11 · Effect: deep retro of a fan-out run in one command · Effort: S · Status: proposed

## Earlier proposals

- 2026-10-06-pr-brief.md P1 — not applied; this run sidestepped it by starting `/implement` in fresh headless sessions
- 2026-10-06-pr-brief.md P2 — not applied — it recurred (F9) — recurring ×2
- 2026-10-06-pr-brief.md P3 — not applied
- 2026-10-06-pr-brief.md P4 — not applied
- 2026-10-06-pr-brief.md P5 — not applied
- 2026-10-06-pr-brief.md P6 — not applied

## For engineering-insights

- The studio's fine-grained GitHub PAT needs explicit Contents/Workflows write per repository; a new target repo must be added to it before Export to CI.
- The workflow on the export PR itself always fails: it checks out the base SHA, where `.devdigest/runner/index.js` does not exist yet.
- `claude -p` headless sessions ran on Sonnet while the interactive session ran on Opus.

## Not established

- The main session's cost: its snapshot ($0.94) is recorded mid-session and cannot cover 55.3M cache-read tokens on Opus; the real figure is higher.
- Human review time of the export PR: the moment the user opened it is not in the conversation.
- Tool-use counts and final context of the headless agents (#5–14): their `<usage>` blocks were not visible to this session.
