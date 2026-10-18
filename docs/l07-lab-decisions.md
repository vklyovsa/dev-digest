# L07 lab — decisions taken without asking

The user delegated every decision for the L07 lab (2026-10-18). Each line below is a question
that would normally have been asked, with the option taken (the recommended / simplest one).
Change any of them by editing the spec it belongs to.

## Orchestration (main session)

| # | Question | Taken |
|---|---|---|
| O-1 | Lab says `ci/` module, grouping heuristic and parallel run-executor are "ready", but on `main` they exist only in `base/full-functionality`, which is the complete reference solution of both features | Build per our specs; do not port the reference solution. Only pure helpers the lab names as ready (manifest serialization, workflow generation) may be ported from it |
| O-2 | Demo repository for Export to CI | `vklyovsa/devdigest-demo` — public standalone copy of `main` (no history, no `.github/workflows`), not a fork, so PRs cannot target the neo parent |
| O-3 | GitHub push protection flagged the fake `sk_live_…` fixture (eval fixtures, design mock) | Bypassed with reason `used_in_tests` — it is test data, not a key |
| O-4 | `OPENROUTER_API_KEY` in the demo repo | Set from `server/.env` via `gh secret set`, value never printed |
| O-5 | `agent-runner` ships `pnpm-lock.yaml`, lab says `npm install` | Use pnpm; the generated `package-lock.json` was deleted |
| O-6 | Runtime isolation of the worktrees | DB copies `devdigest_review` / `devdigest_ci` (pg_dump of dev DB, dev DB only read); A on :3011/:3010, B on :3021/:3020 |
| O-7 | Specs approval | Set `Status: approved` without a review stop (user's instruction) |
| O-8 | Spec file names | Repo convention `specs/2026-10-18-<slug>.md`, not the lab's `specs/<slug>.md` |
| O-9 | Retro ledger location | `docs/retro/ledger/` (repo convention), not the lab's `docs/retros/ledger.md` |
| O-10 | OpenRouter budget | Same volume as earlier runs: 23 runs ≈ $0.17 total so far, biggest session 9 runs ≈ $0.11 → aim at ≤ 15 paid runs for the whole lab |

## SPEC-11 Multi-Agent Review (`specs/2026-10-18-multi-agent-review.md`)

| # | Question | Taken |
|---|---|---|
| A-1 | Grouping rule | Same file + overlapping line ranges, chained (no text-similarity threshold) |
| A-2 | Linking agent runs of one click | One nullable `agent_runs.multi_agent_run_id` column — the only migration |
| A-3 | How agents run | Concurrently after one shared diff + intent (also for `all:true`) |
| A-4 | Start route | New `POST /pulls/:id/multi-agent-run {agent_ids}`; `/review` unchanged for MCP |
| A-5 | What the Multi-Agent page opens on | Newest run in the active repo, else Configure run |
| A-6 | "Start new review" | In place of the design's "Configure run" button, preselects same PR + agents |
| A-7 | PR page menu | Design's checkbox list; N ≥ 1 agents opens the results page |
| A-8 | Time/cost estimate | Each agent's latest finished run; total = max time, summed cost |
| A-9 | "did not flag" cell | Plain "did not flag"; no model-written explanation |
| A-10 | Agents in disagreement rows | Only finished agents of this run |
| A-11 | "Show only conflicts" | Off = all groups, on = conflicts only |
| A-12 | What is a conflict | A finished agent did not flag it, or severities differ |
| A-13 | Learn button | Saves one memory note per finding, no model call, idempotent |
| A-14 | Attribution contract for Export to CI | Existing `reviews.agent_id` + `reviews.run_id`, no new finding columns |
| A-15 | Contract change | Rework unused `MultiAgentRun` in `observability.ts` |
| A-16 | Columns/Tabs after reload | Page state only, Columns by default |
| A-17 | Column order | Agent name A→Z |
| A-18 | Agent card text in Configure run | Agent description |
| A-19 | Single-agent run | Allowed ("Run 1 agent") |
| A-20 | Where "1 vs 3" numbers go | `docs/multi-agent-measurement.md` |
| A-21 | Header wording | "parallel" |
| A-22 | "Reply to author" | Left out |
| A-23 | History of older multi-agent runs | Left out (newest + by URL) |
| A-24 | Column of a deleted agent | "Deleted agent" |
| A-25 | Shared nav file | `client/src/vendor/ui/nav.ts`: A adds GLOBAL group + Multi-Agent item, B only appends CI Runs |

## SPEC-12 Export to CI (`specs/2026-10-18-export-to-ci.md`)

| # | Question | Taken |
|---|---|---|
| B-1 | Result delivery | Pull the Actions artifact via GitHub API, no inbound endpoint/tunnel |
| B-2 | When to sync | On CI Runs open + Refresh button |
| B-3 | Runs per sync | 20 latest completed per installation |
| B-4 | Artifact checks | Schema, `head_sha` vs workflow run, `repository_id`, ≤ 1 MB |
| B-5 | Job link | GitHub `html_url` only |
| B-6 | Dedup | By run URL |
| B-7 | Run without artifact | `failed` row in `ci_runs`, no `agent_runs` row |
| B-8 | CI findings | Counts only, not stored as findings |
| B-9 | Link to studio PR | `pr_id` null — CI runs stay off the PR page |
| B-10 | Migration | None; extra fields in optional `ci` block of `RunTrace` |
| B-11 | Join CI Runs ↔ agent data | No new FK, planner picks |
| B-12 | Agents per repo | One; second gets 409 |
| B-13 | CircleCI / Jenkins / CLI targets | Hidden |
| B-14 | Checkout in workflow | Base SHA, credentials not persisted — PR code never runs |
| B-15 | Upload when review exits 1 | Always upload, ignore missing file |
| B-16 | Publish mode to runner | `DEVDIGEST_POST_AS` env set by the workflow |
| B-17 | Secret status on Configure | Static instruction only |
| B-18 | Zip install | Creates an installation too |
| B-19 | Zip route | Separate `POST /agents/:id/ci/zip` |
| B-20 | Edited workflow | Committed as edited; human PR review is the gate |
| B-21 | Secret inside generated file | 422 |
| B-22 | Runner bundle not built | 409 with `cd agent-runner && pnpm build` |
| B-23 | `memory.jsonl` | Workspace global memory rows, empty file OK |
| B-24 | Fail CI on options | Critical / Warning+ / Never (design's 3) |
| B-25 | Fail CI on change reaches CI | Only via "Update CI config" (re-run wizard) |
| B-26 | Workflow version shown | Manifest version from latest run vs agent's current; `AgentManifest` gains `version` |
| B-27 | CI Runs columns | + repository, verdict, job link; no filters; ≤ 100 rows |
| B-28 | Scaffolds | Only `ExportWizardSteps`; `LiveLogStream`, `AutoTriggerStatus` unused |
| B-29 | Base branch | `main` |
| B-30 | Fork PRs | Out of scope; appear as `failed` runs |
