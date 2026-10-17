# Implementation Plan — Agent Performance dashboard, revision 3 (delta from e72bb9f)
Source: `specs/2026-10-17-agent-performance-dashboard.md` (SPEC-11, Status: approved; `check-spec.sh`: ok, 0 open questions, one WARN that the diagrams were not rendered) · Base: `e72bb9f` · Packages: reviewer-core, server, client

The pointer `spec:N` below means `specs/2026-10-17-agent-performance-dashboard.md:N`. This plan replaces `specs/2026-10-17-agent-performance-dashboard-plan.md`. It plans only what revision 3 adds or changes. Everything marked "already done" exists at `e72bb9f` and must keep passing.

## 0. Before the first edit
- INSIGHTS: `INSIGHTS.md § Codebase Patterns`, "Corrected 2026-10-17: run cost IS persisted now…". This entry says separating billed from estimated cost "needs a new column for the cost source first". Stage 2 adds those columns. Once the plan lands the entry is out of date, so `engineering-insights` should correct it at the end of the run.
- INSIGHTS: `INSIGHTS.md § Codebase Patterns`, "Run cost is already plumbed end-to-end…". It says "never build a second pricing path or a per-run estimation call". The estimate keeps using the injected `estimateCost` (PriceBook). No new price table and no new call.
- INSIGHTS: `INSIGHTS.md § What Works`, "To prove a screen made no model call, diff `agent_runs` / `run_traces`". AC-40's existing test stays as it is. NFR-1's manual check uses this recipe, but only after the user has applied the migration (§7).
- INSIGHTS: `INSIGHTS.md § What Doesn't Work`, "A per-brief filtered check stays green while parallel implementers break each other". After both tracks land, the calling session runs `check-code.sh` unfiltered for each package. A test that counts requests looks through all of `fetchMock.mock.calls`.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work`, "An implementer's token bill is turns × standing context". Briefs cover at most two stages, and each stage has a `Read first:` list.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work`, "The model cannot start `/implement`…". The calling session follows `implement.md` by hand.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work`, "A plan's absence check on generic words…" and "Proving absence with `git grep`…". The absence check in stage 7 uses identifiers only the removed code had (`estimate.mark`, `estimate.note`, `cost_basis`, `COST_BASIS`) and `grep -rn`.
- INSIGHTS: `INSIGHTS.md § Tool & Library Notes`, "pnpm 12.4.2 exits non-zero with `ERR_PNPM_IGNORED_BUILDS`… on `pnpm <script>`". If `pnpm db:generate` stops that way, run the same script directly: `cd server && ./node_modules/.bin/drizzle-kit generate`.
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes`, "`drizzle-kit generate` becomes INTERACTIVE the moment one migration both drops and adds columns". This migration only adds two nullable columns, so no prompt is expected. If drizzle-kit asks anything, stop and report. Never write or edit a migration by hand.
- INSIGHTS: root `§ What Works`, "Any write to the dev DB…", together with the calling session's constraint. Nobody in this run runs `db:migrate`. Only the testcontainers lane applies `0020`.
- INSIGHTS: `server/INSIGHTS.md § Codebase Patterns`, "A studio review is ONE LLM call… `MockLLMProvider` bills… `costUsd` 0.001 per call". AC-50's expectation is therefore 0 billed and 0.001 estimated.
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes`, "`pnpm typecheck` does not look at `test/**`", plus the two `/tmp` tsconfig entries under § Recurring Errors. The calling session type-checks the new and changed server test files (§6). Implementers cannot write `/tmp`.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors`, "The client's vendored `@devdigest/shared` is a TYPE-only dependency". `CostSplit` and the trend enum are imported as types only, and §6 has a `pnpm build` row.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes`, "`client/` typecheck DOES cover `*.test.tsx`". This is why stage 3 updates the client test fixtures together with the contract.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes`, "A bare ICU argument does not group digits". The sparkline peak uses `{peak, number}`.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors`, "`Unable to find an element with the text: $0.0013`". Each delta, split line and trend text is rendered in one element, and the tests assert the joined text.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes`, "A vitest name-fragment filter also matches DIRECTORY names". Filter by file name (`KpiCards.test`) or by the path `src/app/agent-performance/helpers.test.ts`, never by the bare `helpers.test`.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors`, "a CSS grid child has `min-width: auto`". New legend and card cells keep `minmax(0, 1fr)` / `minWidth: 0`.
- INSIGHTS: `reviewer-core/INSIGHTS.md § Open Questions`, "whether OpenRouter bills a generation the client gave up on". The SDK retry settings stay unchanged. EC-30 is answered by the AC-55 note.
- Read: `server/AGENTS.md`, `client/AGENTS.md`, `reviewer-core/AGENTS.md` ("Stay pure", "Consumers use the source"), `TESTING.md § Conventions`.

## 1. Scope — as the source states it
Goal (new in rev. 3):
- G-5: "Every review run written from now on records which part of its cost the model provider reported and which part DevDigest estimated; runs stored earlier keep an unknown source." (`spec:36`)
- G-6: "The dashboard compares the selected period with the one of the same length just before it: runs over time on the Total runs card, the change in total cost, and the direction of each agent's accept rate." (`spec:37`)
- G-1…G-4 (`spec:32-35`) were already done at e72bb9f. G-3 was reworded to cover billed / estimated / unknown, which AC-38 and AC-52…AC-55 below carry.

Non-goals:
- NG-2 (changed): "No reconciliation with the provider's account: the dashboard calls no OpenRouter API, and no run stored before the cost source is recorded is backfilled" (`spec:39`)
- NG-3 (changed): "`GET /agents/:id/stats` returns no runs series and no previous-period figures — a caller that wants the previous period asks for its range." (`spec:40`)
- NG-8 (new): "The other surfaces that show a run's cost (the PR list, the run timeline, the trace drawer) keep showing one amount" (`spec:41`)
- NG-1, NG-4…NG-7 (`spec:38`, `:42-45`): unchanged, still respected.

Acceptance criteria. "done" = already done at e72bb9f and must keep passing in the named test. "this plan" = built here.
- AC-1 "The sidebar shall show an "Agent Performance" item…" (`spec:77`). Done; keep `client/src/components/app-shell/navigation.test.tsx`.
- AC-2 "WHILE the current path is `/agent-performance`, the sidebar shall mark…" (`spec:78`). Done; keep `navigation.test.tsx`.
- AC-3 "…three period choices: 1 day, 30 days and a custom date range." (`spec:79`). Done; keep `AgentPerformanceView.test.tsx`.
- AC-4 "…opens with no period in its URL… shall select the 30 days period." (`spec:80`). Done; keep the View test and `helpers.test.ts`.
- AC-5 "WHEN a period is selected… request `GET /agents/performance` once with `from` and `to`…" (`spec:81`). Done; keep the View test and `helpers.test.ts`.
- AC-6 "IF a custom range ends before it starts, or ends after today…" (`spec:82`). Done; keep the View test and `helpers.test.ts`.
- AC-7 "IF … called without `from` or `to`… THEN the API shall answer 422." (`spec:83`). Done; keep `server/test/agent-performance-routes.test.ts`.
- AC-8 "…four cards… filled from `summary`, each label naming the selected period." (`spec:84`). Done; keep `KpiCards.test.tsx` (the cards change in stage 6).
- AC-9 "The Avg accept rate card shall show… the number of decisions… and the number of runs" (`spec:85`). Done; keep `KpiCards.test.tsx`.
- AC-10 "The Most-active agent card shall show that agent's name, its counted runs and its accept rate." (`spec:86`). Done; keep `KpiCards.test.tsx`.
- AC-11 "…a table with the columns Agent, Runs, Avg cost, Avg duration, Accept rate, Last run and View…" (`spec:87`). Done; keep `AgentTable.test.tsx` (its header assertion changes in stage 7).
- AC-12 "The Accept rate cell… shall show the rate together with its denominator…" (`spec:88`). Done; keep `AgentTable.test.tsx`.
- AC-13 "WHILE an agent has fewer than 10 decisions… a "small sample" text mark…" (`spec:89`). Done; keep `AgentTable.test.tsx` and `agent-performance-helpers.test.ts`.
- AC-14 "WHEN the table is sorted by Accept rate…" (`spec:90`). Done; keep `AgentTable.test.tsx` and `helpers.test.ts`.
- AC-15 "WHEN the table first renders… sort it by Accept rate, highest first." (`spec:91`). Done; keep `AgentTable.test.tsx`.
- AC-16 "WHEN the user activates View… navigate to `/agents/<agent_id>`" (`spec:92`). Done; keep `AgentTable.test.tsx`.
- AC-17 "WHILE a row stands for the runs of deleted agents… "Deleted agent"…" (`spec:93`). Done; keep `AgentTable.test.tsx`.
- AC-18 "…a Cost breakdown section with two charts, By agent and By model, each with a legend…" (`spec:94`). Done; keep `CostBreakdown.test.tsx` (the legend changes in stage 7).
- AC-19 "WHILE no run counted in the period has a cost… "No cost recorded for this period"…" (`spec:95`). Done; keep `CostBreakdown.test.tsx`.
- AC-20 "The API shall count a review run… [`from`, `to`)… `done`, `failed` or `cancelled`." (`spec:96`). Done; keep `agent-performance.it.test.ts`.
- AC-21 "…`total_cost_usd` the sum of `cost_usd`… `avg_cost_usd` that sum divided by…" (`spec:97`). Done; keep the it test.
- AC-22 "…`avg_latency_ms` the mean `duration_ms`… status is `done`." (`spec:98`). Done; keep the it test.
- AC-23 "…`accepted` and `dismissed` the findings (of every kind)…" (`spec:99`). Done; keep the it test.
- AC-24 "…`summary.total_cost_usd` equal to the sum… over `agents`, to the sum of `cost_by_agent` and to the sum of `cost_by_model`." (`spec:100`). Done; keep the it test and the helpers test. Stages 4–5 must not break it.
- AC-25 "…group `cost_by_model` by the `model` stored on each run…" (`spec:101`). Done; keep the it test.
- AC-26 "…`summary.runs`… `summary.most_active_agent`… ties going to the agent with the newer last run…" (`spec:102`). Done; keep the it test and the helpers test.
- AC-27 "…`summary.avg_accept_rate` as the sum of `accepted`… divided by the sum of `decisions`…" (`spec:103`). Done; keep the helpers test.
- AC-28 "…list in `agents` every agent of the workspace, enabled or not…" (`spec:104`). Done; keep the it test.
- AC-29 "…gather the counted runs whose agent was deleted into one `agents` row and one `cost_by_agent` segment…" (`spec:105`). Done; keep the it test and the helpers test.
- AC-30 "…`unpriced_runs` as the number of counted runs that have no cost." (`spec:106`). Done; keep the it test.
- AC-31 "…count the runs of every repository of the caller's workspace and no run, review or finding of another workspace." (`spec:107`). Done; keep the it test.
- AC-32 "WHEN `GET /agents/:id/stats` is called… equal to that agent's row of `GET /agents/performance`…" (`spec:108`). Done; keep the it test.
- AC-33 "IF `GET /agents/:id/stats` names an agent that is not in the caller's workspace, THEN… 404." (`spec:109`). Done; keep the it test.
- AC-34 "WHILE the response… has not arrived… placeholders without any number…" (`spec:110`). Done; keep the View test.
- AC-35 "IF the request fails… an error message and a Retry control…" (`spec:111`). Done; keep the View test.
- AC-36 "WHILE the response counts no run in the period… one empty state…" (`spec:112`). Done; keep the View test.
- AC-37 "WHILE at least one run is counted and an agent has none… "No runs in this period"…" (`spec:113`). Done; keep `AgentTable.test.tsx`.
- AC-38 (changed, this plan): "The Total cost card shall show under the total, each named in text, the amount billed by the provider, the DevDigest estimate and the amount of unknown source, leaving out a part that is zero." (`spec:114`). Clear. The old "DevDigest estimate" mark on three surfaces is removed in stages 6–7.
- AC-39 "WHILE `summary.unpriced_runs` is above 0… how many counted runs the total leaves out." (`spec:115`). Done; keep `KpiCards.test.tsx`.
- AC-40 "The API shall answer `GET /agents/performance` and `GET /agents/:id/stats` without calling a model provider and without writing a row to any table." (`spec:116`). Done; keep the it test ("writes no row and calls no model provider").
- AC-41 "The Agent Performance screen shall send only GET requests…" (`spec:117`). Done; keep the View test.
- AC-42 "…`last_run_at` the newest `ran_at` among its counted runs." (`spec:118`). Done; keep the it test.
- AC-43 "…cut a long agent name or model name with an ellipsis…" (`spec:119`). Done; keep `AgentTable.test.tsx` and `CostBreakdown.test.tsx`.
- AC-44 "WHEN a period is selected… write that period into the URL query…" (`spec:120`). Done; keep the View test.
- AC-45 "WHEN the Agent Performance screen opens with a valid period in its URL…" (`spec:121`). Done; keep the View test.
- AC-46 "…counted runs that have no stored `model` into one `cost_by_model` segment with `label` null… "Unknown model"." (`spec:122`). Done; keep the it test and `CostBreakdown.test.tsx`.
- AC-47 (this plan): "The Agent Performance screen shall show the subtitle "Which agents earn their keep — accept rate is the quality signal" under its title." (`spec:123`). Clear.
- AC-48 (this plan): "WHEN a model response of a review run carries a provider-reported `usage.cost`, the review engine shall count that response's cost as billed, and otherwise count the DevDigest estimate for that response's tokens as estimated, the rule applying to every response, re-asks included." (`spec:124`). Clear.
- AC-49 (this plan): "The API shall count the whole cost of a model response from the OpenAI or Anthropic adapters as estimated." (`spec:125`). Clear.
- AC-50 (this plan): "WHEN a review run completes, the API shall store with the run its billed part and its estimated part, which add up to the run's stored `cost_usd`, both empty when `cost_usd` is null." (`spec:126`). Clear. The column type is question 2.
- AC-51 (this plan): "The API shall report the cost of a run stored before its parts were recorded as of unknown source, never as billed and never as estimated." (`spec:127`). Clear.
- AC-52 (this plan): "The API shall return for `summary`, for every `agents` row and for every `cost_by_agent` and `cost_by_model` segment a `cost_split` of `billed_usd`, `estimated_usd` and `unknown_usd` whose sum equals that figure's cost." (`spec:128`). Clear.
- AC-53 (this plan): "The Avg cost cell shall name the basis of the agent's cost as "Billed", "Estimate" or "Unknown source" when one part holds all of it, and "Mixed" when more than one part is above zero." (`spec:129`). Clear.
- AC-54 (this plan): "Each legend entry of the Cost breakdown shall name the basis of its segment in the words of AC-53 beside its amount." (`spec:130`). Clear.
- AC-55 (this plan): "The Agent Performance screen shall state that a billed amount is the cost the provider reported in its responses to DevDigest, not a figure read from the provider's account." (`spec:131`). Clear.
- AC-56 (this plan): "The API shall compute the previous period as [`from` − (`to` − `from`), `from`) and its figures by the counting rules of the selected period." (`spec:132`). Clear.
- AC-57 (this plan): "The API shall return `runs_series` as consecutive buckets from `from` to `to`, one hour long when the period is at most 48 hours and one day (24 hours) long otherwise, the last one ending at `to`, whose run counts add up to `summary.runs`." (`spec:133`). Clear. With EC-25, the last bucket is cut off at `to`.
- AC-58 (this plan): "The Total runs card shall show a sparkline of `runs_series` beside the total, with a text alternative naming the bucket size and the highest bucket." (`spec:134`). Clear.
- AC-59 (this plan): "The API shall report `summary.cost_delta_usd` as `total_cost_usd` minus the previous period's `total_cost_usd`, null when either of the two is null." (`spec:135`). Clear.
- AC-60 (this plan): "WHILE `summary.cost_delta_usd` is not null, the Total cost card shall show it with its sign beside the total and name the comparison in text." (`spec:136`). Clear.
- AC-61 (this plan): "WHILE `summary.cost_delta_usd` is null, the Total cost card shall show "No earlier period to compare" in place of the delta." (`spec:137`). Clear.
- AC-62 (this plan): "The API shall report for each `agents` row an `accept_trend` of `up` when its accept rate rounded to a whole percent is above the previous period's, `down` when below, `flat` when equal, and null when either period has no rate or is a small sample." (`spec:138`). Clear.
- AC-63 (this plan): "WHILE a row's `accept_trend` is `up` or `down`, the Accept rate cell shall show an up or down arrow whose text names the previous rate." (`spec:139`). Clear.
- AC-64 (this plan): "IF a response's `usage.cost` is not a finite number of at least 0, THEN the review engine shall treat it as absent and estimate that response's cost." (`spec:140`). Clear.
- AC-65 (this plan): "WHEN `GET /agents/:id/stats` is called with `from` and `to`, the API shall return a `cost_split` equal to that agent's `cost_split` in `GET /agents/performance` for the same range." (`spec:141`). Clear.

NFR:
- NFR-6 (this plan): "The stored `cost_usd` of every run written before the parts are recorded stays as it is, and no migration, job or request writes a billed or estimated part for such a run." (`spec:183`)
- NFR-7 (this plan): "Recording the parts of a run's cost adds no model call and no request to OpenRouter beyond the review's own calls." (`spec:184`)
- NFR-1…NFR-5 (`spec:178-182`): done, keep. NFR-2 now also covers `cost_split` and the `StructuredResult` block (`spec:189`, `:277-279`). NFR-4 adds the cost basis, the delta's sign and the trend arrows.

Edge cases this plan covers: EC-22…EC-30 (`spec:166-174`). EC-1…EC-21 were done at e72bb9f.

## 2. Impact map
| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| server + client | `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/adapters.ts` (`StructuredResult` block only) | Modify | LLM port, both copies | AC-48, 49, NFR-2 |
| reviewer-core | `reviewer-core/src/llm/openrouter.ts` | Modify | engine's provider | AC-48, 64, NFR-7, EC-26, 27, 29 |
| reviewer-core | `reviewer-core/src/review/run.ts` | Modify | engine (`ReviewOutcome`) | AC-48, EC-26, 29 |
| reviewer-core | `reviewer-core/test/openrouter.test.ts` | New | hermetic unit | AC-48, 64, NFR-7 |
| reviewer-core | `reviewer-core/test/run.test.ts` | Modify | hermetic unit | AC-48, EC-26 |
| server | `server/src/adapters/llm/pricing.ts`, `openai.ts`, `anthropic.ts` | Modify | driven adapters | AC-49 |
| server | `server/src/adapters/mocks.ts`, `server/test/helpers/eval.ts` | Modify | port mocks | AC-50 |
| server | `server/test/llm-cost-parts.test.ts` | New | hermetic unit | AC-49 |
| server | `server/src/db/schema/runs.ts` | Modify | schema | AC-50, 51, NFR-6 |
| server | `server/src/db/migrations/0020_*.sql` + `meta/` | New (generated) | migration | AC-50, NFR-6 |
| server | `server/src/modules/reviews/repository/run.repo.ts`, `server/src/modules/reviews/repository.ts`, `server/src/modules/reviews/run-executor.ts` | Modify | repository / application | AC-50 |
| server | `server/test/reviews.it.test.ts` | Modify | DB-backed | AC-50 |
| server + client | `{server,client}/src/vendor/shared/contracts/{observability,productionize}.ts` | Modify | contracts, both copies | AC-52, 56, 57, 59, 62, 65, NFR-2 |
| client | `…/AgentPerformanceView.test.tsx`, `…/KpiCards/KpiCards.test.tsx`, `…/AgentTable/AgentTable.test.tsx`, `…/CostBreakdown/CostBreakdown.test.tsx` | Modify (fixtures in stage 3, assertions in 6–7) | tests | AC-38, 47, 53, 54, 55, 58, 60, 61, 63 |
| server | `server/src/modules/agent-performance/{constants,types,helpers}.ts` | Modify | pure rules + consumer-declared port | AC-52, 56, 57, 59, 62, 65 |
| server | `server/src/modules/agent-performance/{repository,service}.ts` | Modify | repository / application | AC-51, 52, 56, 57 |
| server | `server/test/agent-performance-helpers.test.ts`, `server/test/agent-performance.it.test.ts` | Modify | unit / DB-backed | AC-51, 52, 56, 57, 59, 62, 65, NFR-6 |
| client | `client/messages/en/agentPerformance.json` | Modify | copy | AC-38, 47, 53…55, 58, 60, 61, 63, NFR-3 |
| client | `client/src/app/agent-performance/{constants,helpers,helpers.test}.ts` | Modify | route-level helpers | AC-38, 53, 54, 58, 60 |
| client | `…/AgentPerformanceView/_components/KpiCards/KpiCards.tsx` | Modify | child of the view | AC-38, 55, 58, 60, 61 |
| client | `…/AgentPerformanceView/_components/AgentTable/AgentTable.tsx` (+ `styles.ts`) | Modify | child of the view | AC-53, 63 |
| client | `…/AgentPerformanceView/_components/CostBreakdown/CostBreakdown.tsx` | Modify | child of the view | AC-54 |
| client | `…/AgentPerformanceView/AgentPerformanceView.tsx`, `styles.ts` | Modify | route container | AC-47 (plus the new KpiCards props) |

Every listed path exists at e72bb9f except the two new test files and the generated migration.

## 3. Constraints in play
- depcruise rules that must stay green: `no-cross-module-internals` (`agent-performance` reads tables only through its own `repository.ts`; it never imports `reviews/*`), `drizzle-only-in-repositories`, `no-service-to-container`, `core-purity` (reviewer-core gets no new import: the estimator stays injected, and the purity grep `grep -rnE "from 'node:|process\.env" reviewer-core/src` returns nothing new).
- Two contract copies: `CostSplit`, `AgentStats`, `AgentPerfRow`, `PerfCostSegment` and `AgentPerf` change identically in both copies. The existing `productionize.ts:36` hunk stays. In `adapters.ts`, only the `StructuredResult` block changes and must be identical in both copies. The many existing differences between the two `adapters.ts` copies stay.
- Migration: `pnpm db:generate` produces `0020_*.sql` with two `ADD COLUMN` statements: nullable, no `DEFAULT`, no `UPDATE` (NFR-6). It is never applied to the dev DB in this run.
- Column type: `double precision`, the type of the `cost_usd` column the parts must sum to. This goes against `postgresql-table-design/SKILL.md § Data Types` ("Money: `NUMERIC(p,s)` (never float)"). It is a declared deviation that the user decides in question 2.
- Wire names are snake_case (`cost_split.billed_usd`). TS and Drizzle names are camelCase (`costBilledUsd` / `cost_billed_usd`, `costEstimatedUsd` / `cost_estimated_usd`).
- i18n: every new string goes into `client/messages/en/agentPerformance.json`. Counts use `{x, number}`.
- The client imports `CostSplit`, `AgentPerf` and the rest with `import type` only.
- NG-8: `RunTrace.stats`, the PR list cost, the timeline and the drawer stay unchanged.
- Nothing in the dashboard path calls a model or OpenRouter. `run_traces` / `agent_runs` writes are unchanged.

## 4. Stages

### Stage 1 — Cost parts per model response: port, engine, adapters
Track: shared · After: —
Files: `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/adapters.ts`, `reviewer-core/src/llm/openrouter.ts`, `reviewer-core/src/review/run.ts`, `reviewer-core/test/run.test.ts`, `reviewer-core/test/openrouter.test.ts` (New), `server/src/adapters/llm/pricing.ts`, `server/src/adapters/llm/openai.ts`, `server/src/adapters/llm/anthropic.ts`, `server/src/adapters/mocks.ts`, `server/test/helpers/eval.ts`, `server/test/llm-cost-parts.test.ts` (New)
Read first: `server/src/vendor/shared/adapters.ts:72-88` (the port), `client/src/vendor/shared/adapters.ts` (the same `StructuredResult` block, around `:66`), `reviewer-core/src/llm/openrouter.ts:27-116` (the attempt loop and today's `costFromApi`), `reviewer-core/src/review/run.ts:116-134,178-247` (`ReviewOutcome`, chunk accumulation), `server/src/adapters/llm/openai.ts:89-129`, `server/src/adapters/llm/anthropic.ts:88-140`, `server/src/adapters/llm/pricing.ts`, `server/src/adapters/mocks.ts:60-107`, `server/test/helpers/eval.ts:200-218`, `reviewer-core/test/run.test.ts:100-130` (stub pattern)
Steps:
1. In both copies of `StructuredResult`, add `costBilledUsd: number | null` and `costEstimatedUsd: number | null`. Add one doc line: they add up to `costUsd` and are both null when `costUsd` is null. Change nothing else in either `adapters.ts`.
2. In `openrouter.ts` `completeStructured`, replace `costFromApi` with per-attempt accounting.
   - Read the attempt's own `prompt_tokens` / `completion_tokens`.
   - The attempt is billed only when `typeof reported === 'number' && Number.isFinite(reported) && reported >= 0` (AC-64, UI-4). Then add `reported` to `billed`.
   - Otherwise compute `est = this.estimateCost?.(req.model, attemptIn, attemptOut) ?? null`. If `est` is null, mark the call unpriced; otherwise add it to `estimated`.
   - Call the estimator only for attempts without a valid reported cost (NFR-7).
   - On success return `costUsd = unpriced ? null : billed + estimated`, `costBilledUsd = unpriced ? null : billed`, `costEstimatedUsd = unpriced ? null : estimated`.
   - Requests, retries and `usage: { include: true }` stay unchanged.
3. In `run.ts`, give `ReviewOutcome` `costBilledUsd` and `costEstimatedUsd` (`number | null`), accumulated per chunk next to `costUsd`.
   - If `costUsd` or `res.costUsd` is null, all three become null (EC-29).
   - Otherwise add `res.costBilledUsd ?? 0` to billed, and `res.costEstimatedUsd ?? (res.costUsd - (res.costBilledUsd ?? 0))` to estimated. A provider that leaves the parts out therefore counts as estimated.
4. In `pricing.ts`, export `estimatedOnly(costUsd: number | null)`, returning `{ costUsd, costBilledUsd: costUsd === null ? null : 0, costEstimatedUsd: costUsd }`. `OpenAIProvider.completeStructured` and `AnthropicProvider.completeStructured` spread it into their result (AC-49). `complete()` and `CompletionResult` stay unchanged.
5. `MockLLMProvider.completeStructured` and the eval mock in `test/helpers/eval.ts` return `costBilledUsd: 0, costEstimatedUsd: 0.001`. The stubs in `reviewer-core/test/run.test.ts` return `costBilledUsd: 0, costEstimatedUsd: 0`.
Skills: `onion-architecture` → `rules/domain-purity.md` § "New capability arrives as a port" (the estimator stays injected; no price table in reviewer-core); `rules/ports-and-di.md` § "Adapters do not know about modules"; `rules/zod-contracts.md` § "Both copies must change"; `rules/testing.md` § "Mocks belong to the ports". `typescript-expert` → `SKILL.md` (narrow `usage.cost` with a type guard, not a wider cast; typed `vi.mock` factories). `security` → `SKILL.md` § A08 Software and Data Integrity (`usage.cost` is third-party data, UI-4). `zod` → `SKILL.md` (routed by path; no schema change in this stage).
Tests to add:
- `reviewer-core/test/openrouter.test.ts`: `vi.mock('openai')` with a default class whose `chat.completions.create` is a `vi.fn` returning queued responses.
  - (a) Attempt 1 is invalid JSON with `usage.cost` 0.002; attempt 2 is valid with no cost; the estimator `vi.fn` returns 0.0005. Expect billed 0.002, estimated 0.0005, `costUsd` 0.0025; `create` called twice; the estimator called once with attempt 2's tokens (AC-48, EC-26, NFR-7).
  - (b) `usage.cost` of `NaN`, `-1` and `"0.1"`: each gives billed 0 and estimated equal to the estimator's value (AC-64).
  - (c) The estimator returns null on an attempt without a cost: all three are null (EC-29).
- `reviewer-core/test/run.test.ts`: in map-reduce with two chunks, a stub answers (0.01 billed, 0 est.) then (0, 0.02). The outcome is 0.01 / 0.02 / 0.03. One chunk with `costUsd: null` makes all three null.
- `server/test/llm-cost-parts.test.ts`: `vi.mock('openai')` and `vi.mock('@anthropic-ai/sdk')` answer one valid structured response on `gpt-4.1` / `claude-3-5-haiku-latest`. Each adapter gives `costBilledUsd` 0 and `costEstimatedUsd === costUsd` (AC-49).
Done when: `.claude/agents/scripts/check-code.sh reviewer-core` passes (reviewer-core typecheck, server typecheck, reviewer-core tests); `.claude/agents/scripts/check-code.sh server -- llm-cost-parts adapters.test` passes; and `diff <(sed -n '/^export interface StructuredResult/,/^}/p' server/src/vendor/shared/adapters.ts) <(sed -n '/^export interface StructuredResult/,/^}/p' client/src/vendor/shared/adapters.ts)` prints nothing.

### Stage 2 — Store the parts with each run: schema, migration, completion
Track: shared · After: 1 · Waits for question 2 (column type).
Files: `server/src/db/schema/runs.ts`, `server/src/db/migrations/0020_*.sql` + `server/src/db/migrations/meta/{0020_snapshot.json,_journal.json}` (generated), `server/src/modules/reviews/repository/run.repo.ts`, `server/src/modules/reviews/repository.ts`, `server/src/modules/reviews/run-executor.ts`, `server/test/reviews.it.test.ts`
Read first: `server/src/db/schema/runs.ts:1-33`, `server/src/modules/reviews/repository/run.repo.ts:142-177`, `server/src/modules/reviews/repository.ts:142-161`, `server/src/modules/reviews/run-executor.ts:355-450,495-515` (success and failure completion), `server/test/reviews.it.test.ts:172-250` (the cost assertions to extend)
Steps:
1. In `runs.ts`, after `costUsd`, add `costBilledUsd: doublePrecision('cost_billed_usd')` and `costEstimatedUsd: doublePrecision('cost_estimated_usd')`: nullable, no default. Add one doc line: "null on runs stored before the parts were recorded — read as unknown source".
2. Run `cd server && pnpm db:generate`, or `./node_modules/.bin/drizzle-kit generate` if pnpm exits with `ERR_PNPM_IGNORED_BUILDS` first.
   - Expected output: `0020_<name>.sql` holding exactly two `ALTER TABLE "agent_runs" ADD COLUMN … double precision;`, plus the snapshot and the journal entry.
   - If drizzle-kit prompts, stop and report.
   - Never run `db:migrate` or `db:seed`.
3. `completeAgentRun` (both `run.repo.ts` and the `ReviewsRepository` wrapper) accepts `costBilledUsd?: number | null` and `costEstimatedUsd?: number | null` and writes them with `?? null`.
4. In `run-executor.ts`, the success path destructures `costBilledUsd` / `costEstimatedUsd` from `outcome` and passes them to `completeAgentRun`. Leave the failure paths (`:87`, `:504`) as they are, so they write null. `RunTrace.stats` stays unchanged (NG-8).
Skills: `drizzle-orm-patterns` → `references/schema-definition.md`, `references/migrations.md`. `postgresql-table-design` → `SKILL.md` § Safe Schema Evolution (a nullable column with no default: no rewrite, no backfill) and § Data Types (the declared deviation, question 2). `onion-architecture` → `rules/drizzle-persistence.md` § Migrations and § "Drizzle imports live in exactly one kind of file"; `rules/testing.md` § "The suffix routes the CI lane". `fastify-best-practices` → `rules/testing.md` (`app.inject()`).
Tests to add: `server/test/reviews.it.test.ts`.
- "runs a review…" (`:172`): `run!.costBilledUsd` is 0, `run!.costEstimatedUsd` ≈ 0.001, and their sum ≈ `run!.costUsd` (AC-50).
- "a failed run records no cost" (`:230`): both parts are null (AC-50, EC-29).
Done when:
- `ls server/src/db/migrations/0020_*.sql` shows one file.
- `grep -c 'ADD COLUMN' server/src/db/migrations/0020_*.sql` prints 2.
- `grep -ciE 'UPDATE|DEFAULT|DROP' server/src/db/migrations/0020_*.sql` prints 0.
- `.claude/agents/scripts/check-code.sh --it server -- reviews.it` passes, with the integration file executed, not skipped.

### Stage 3 — Dashboard contracts in both copies
Track: shared · After: 2
Files: `server/src/vendor/shared/contracts/observability.ts`, `client/src/vendor/shared/contracts/observability.ts`, `server/src/vendor/shared/contracts/productionize.ts`, `client/src/vendor/shared/contracts/productionize.ts`; fixtures only in `client/src/app/agent-performance/_components/AgentPerformanceView/AgentPerformanceView.test.tsx`, `…/_components/KpiCards/KpiCards.test.tsx`, `…/_components/AgentTable/AgentTable.test.tsx`, `…/_components/CostBreakdown/CostBreakdown.test.tsx`
Read first: `server/src/vendor/shared/contracts/productionize.ts:135-206`, `server/src/vendor/shared/contracts/observability.ts:88-125`, the fixture blocks of the four client tests (`AgentPerformanceView.test.tsx:31-100`, `KpiCards.test.tsx:1-35`, `AgentTable.test.tsx:1-56`, `CostBreakdown.test.tsx:1-21`), and `spec:235-279` (the contract tables)
Steps:
1. `observability.ts`: `export const CostSplit = z.object({ billed_usd: z.number(), estimated_usd: z.number(), unknown_usd: z.number() })` plus `export type CostSplit`. `AgentStats` gains `cost_split: CostSplit`.
2. `productionize.ts`: `import { CostSplit } from './observability.js'`.
   - `AgentPerfRow` gains `cost_split: CostSplit`, `previous_accept_rate: z.number().nullable()` and `accept_trend: z.enum(['up', 'down', 'flat']).nullable()`.
   - `PerfCostSegment` gains `cost_split: CostSplit`, so both breakdowns carry it.
   - `AgentPerf` loses `cost_basis` and gains `runs_series: z.array(z.object({ start: z.string(), runs: z.number().int() }))` and `previous: z.object({ from: z.string(), to: z.string(), runs: z.number().int(), total_cost_usd: z.number().nullable() })`.
   - `summary` gains `cost_split: CostSplit` and `cost_delta_usd: z.number().nullable()`.
   - Make the same edit in both copies.
3. In the four client test fixtures, remove `cost_basis` and add the new required fields with neutral values: `cost_split` with zeros (or matching the fixture's cost), `previous_accept_rate: null`, `accept_trend: null`, `runs_series: []`, `previous` with zero runs and null cost, `cost_delta_usd: null`. Do not change any assertion.
Skills: `zod` → `references/object-optional-vs-nullable.md` (required `.nullable()`, never `.optional()`, for the new fields), `references/schema-use-enums.md` (`accept_trend`), `references/type-export-schemas-and-types.md`. `onion-architecture` → `rules/zod-contracts.md` § "Both copies must change" and § "Naming and casing". `react-testing-library` → `SKILL.md` (fixtures typed to the contract).
Tests to add: none. The existing client suite must stay green on the new types.
Done when:
- `diff -u server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts` prints nothing.
- `diff -u server/src/vendor/shared/contracts/productionize.ts client/src/vendor/shared/contracts/productionize.ts` prints only the existing `:36` hunk.
- `.claude/agents/scripts/check-code.sh client` passes.
- `.claude/agents/scripts/check-code.sh --no-tests server` reports type errors only under `server/src/modules/agent-performance/`. That is expected; stages 4–5 close them.

### Stage 4 — Pure rules: cost split, previous period, trend, runs series, delta (server)
Track: server · After: 3
Files: `server/src/modules/agent-performance/constants.ts`, `types.ts`, `helpers.ts`, `server/test/agent-performance-helpers.test.ts`
Read first: `server/src/modules/agent-performance/helpers.ts`, `types.ts`, `constants.ts`, `server/test/agent-performance-helpers.test.ts`
Steps:
1. `constants.ts`: remove `COST_BASIS`. Add `HOUR_MS`, `DAY_MS` and `SERIES_HOURLY_MAX_MS = 48 * HOUR_MS`.
2. `types.ts`:
   - `CostParts { billedUsd: number; estimatedUsd: number; unknownUsd: number }`. `RunAggregate` and `ModelCost` extend it.
   - `SeriesCount { bucket: number; runs: number }`.
   - `AgentPerformanceStore` gains `runsSeries(workspaceId, range, bucketMs): Promise<SeriesCount[]>`.
   - `PeriodAggregates { runs: RunAggregate[]; decisions: DecisionAggregate[] }`.
3. `helpers.ts`:
   - `previousRange(range)` returns `{ from: from − (to − from), to: from }` (AC-56).
   - `seriesBucketMs(range)` returns `HOUR_MS` when `to − from ≤ SERIES_HOURLY_MAX_MS`, `DAY_MS` otherwise.
   - `buildRunsSeries(range, bucketMs, counts)` returns `n = ceil((to − from) / bucketMs)` buckets, with `start = from + i·bucketMs` as an ISO string and missing buckets filled with 0. The last bucket is cut off at `to` (AC-57, EC-24, EC-25).
   - `toCostSplit(parts | undefined)` returns the snake_case split, all zeros when there is no data. `toRowFigures` adds `cost_split`; `mergeRuns` sums the three parts (deleted agents).
   - Build rows with one function for both periods, so the previous period follows the same rules (AC-56).
   - `summary.cost_split` is the sum of the row splits (AC-52). `summary.cost_delta_usd` is `cur − prev` when both totals are non-null, else null (AC-59).
   - `previous` is `{ from, to, runs, total_cost_usd }`, computed by the same summation over the previous rows.
   - For each row:
     - `previous_accept_rate` comes from the previous row with the same `agent_id` (null id = the deleted-agents row).
     - `accept_trend` is null if either rate is null or either row is a small sample. Otherwise compare `Math.round(rate * 100)`: higher → `up`, lower → `down`, equal → `flat` (AC-62).
   - `cost_by_agent` segments carry their row's `cost_split`. `cost_by_model` segments carry their model's split.
   - `buildPerformance` takes one object: `{ agents, current: { runs, decisions, modelCosts, series }, previous: { runs, decisions }, range }`.
   - `buildStats` adds `cost_split` (AC-65) and nothing else (NG-3).
4. Move the existing helper tests to the new `buildPerformance` signature. Their assertions (AC-13, AC-24, AC-26, AC-27, AC-29) stay.
Skills: `onion-architecture` → `rules/domain-purity.md` § "Rules live in the core, not in helpers of a service" (every rule stays pure and in `helpers.ts`); `rules/ports-and-di.md` § "A port is defined by the consumer" (`runsSeries` on `AgentPerformanceStore`); `rules/testing.md` § "Use-case tests use mocks, not a database".
Tests to add (`server/test/agent-performance-helpers.test.ts`):
- AC-52: every split sums to its figure, and the summary split equals the sum of the row splits.
- AC-56: `previous` equals the summary of a build that treats the previous aggregates as the current period.
- AC-57: 24 h gives 24 buckets, 30 d gives 30, a 3-day custom range gives 3, and a 71 h DST range gives 3 with the last one cut off. Each series sums to `runs`.
- AC-59: a delta, and null when either total is null.
- AC-62: `up` / `down` / `flat` (0.644 against 0.636 is flat), and null for a small sample and for no previous rate.
- AC-65: the `buildStats` split equals the row split.
Done when: the tests line of `.claude/agents/scripts/check-code.sh server -- agent-performance-helpers` passes. The typecheck line may still show errors in `repository.ts` / `service.ts` only; stage 5 closes them in the same brief.

### Stage 5 — Repository, service, integration tests (server)
Track: server · After: 4
Files: `server/src/modules/agent-performance/repository.ts`, `service.ts`, `server/test/agent-performance.it.test.ts`
Read first: `server/src/modules/agent-performance/repository.ts`, `service.ts`, `server/test/agent-performance.it.test.ts:20-177,373-438` (seed helpers, the stats-equality and no-write cases)
Steps:
1. `runAggregates` and `costByModel` select three more fields:
   - `billedUsd`: `coalesce(sum(cost_billed_usd), 0)`
   - `estimatedUsd`: `coalesce(sum(cost_estimated_usd), 0)`
   - `unknownUsd`: `coalesce(sum(cost_usd) filter (where cost_billed_usd is null and cost_estimated_usd is null), 0)` (AC-51)
   - Map them with `Number(...)`.
2. New `runsSeries`: `floor((extract(epoch from ran_at) * 1000 - ${fromMs}) / ${bucketMs})::int` as `bucket`, `count(*)`, under the existing `countedRuns` predicate, grouped by `bucket`. The numbers are bound as parameters (UI-1).
3. `service.performance` computes `prev = previousRange(range)` and `bucketMs = seriesBucketMs(range)`. It then runs `Promise.all` over `listAgents`, `runAggregates(range)`, `decisionAggregates(range)`, `costByModel(range)`, `runsSeries(range, bucketMs)`, `runAggregates(prev)` and `decisionAggregates(prev)`, and passes the results to `buildPerformance`. `agentStats` is unchanged apart from the split `buildStats` now adds.
4. Integration test: `mkRun` gains `costBilledUsd` / `costEstimatedUsd`. Add a `perfRange(from, to)` query helper. New cases use months not used yet, and the previous window of each such month must also be unused.
Skills: `onion-architecture` → `rules/drizzle-persistence.md` § "Queries, indexes and pgvector are invisible upward" (the service asks for aggregates, not queries); `rules/layers.md` (route → service → store); `rules/testing.md`. `drizzle-orm-patterns` → `references/queries-joins-aggregations.md` (`filter`, `coalesce`, typed `sql<>`). `fastify-best-practices` → `rules/testing.md` (`app.inject()`).
Tests to add (`server/test/agent-performance.it.test.ts`):
- AC-51: a seeded run with `cost_usd` and no parts adds to `unknown_usd` only.
- AC-52: on a mix of new and older runs, every split sums to its figure, and the summary split equals the sum of the row splits; AC-24's four sums still agree.
- AC-56: the `previous` figures equal a call made with the previous range.
- AC-57: 24 h → 24 buckets, 30 d → 30, 3 d → 3, each summing to `runs`.
- AC-59: costs in both periods give the difference; an empty previous period gives null.
- AC-62: one row per case gives `up`, `down`, `flat` and null.
- AC-65: the stats split equals the row split for every agent.
- NFR-6: a seeded earlier run reads back with the same `cost_usd` and null parts after a dashboard call.
- All existing cases (AC-20…AC-33, AC-40, AC-42, AC-46) stay green.
Done when: `.claude/agents/scripts/check-code.sh --it server` passes (typecheck, depcruise, unit lane, integration lane), with `agent-performance.it.test.ts` executed, not skipped (report the count).

### Stage 6 — Copy, helpers and KPI cards (client)
Track: client · After: 3
Files: `client/messages/en/agentPerformance.json`, `client/src/app/agent-performance/constants.ts`, `helpers.ts`, `helpers.test.ts`, `…/AgentPerformanceView/_components/KpiCards/KpiCards.tsx`, `KpiCards.test.tsx`, `…/AgentPerformanceView/AgentPerformanceView.tsx` (the `<KpiCards>` call only)
Read first: `client/messages/en/agentPerformance.json`, `client/src/app/agent-performance/helpers.ts`, `constants.ts`, `helpers.test.ts:1-60`, `…/KpiCards/KpiCards.tsx`, `KpiCards.test.tsx`, `client/src/vendor/ui/charts/Sparkline.tsx`, `…/AgentPerformanceView/AgentPerformanceView.tsx:52-110`
Steps:
1. Messages. Add these keys and keep `estimate.*` until stage 7:
   - `subtitle`: "Which agents earn their keep — accept rate is the quality signal"
   - `basis.{billed,estimate,unknown,mixed}`: "Billed", "Estimate", "Unknown source", "Mixed" (the words of AC-53)
   - `kpi.split.{billed,estimate,unknown}`: "Billed {amount}", "Estimate {amount}", "Unknown source {amount}"
   - `kpi.billedNote`: "Billed is the cost the provider reported in its responses to DevDigest, not a figure read from the provider's account."
   - `kpi.delta`: "{sign}{amount} vs previous {days}d"
   - `kpi.noPrevious`: "No earlier period to compare"
   - `kpi.series`: "Runs per {unit, select, hour {hour} other {day}}, peak {peak, number}"
   - `table.trendUp`: "up from {rate}"; `table.trendDown`: "down from {rate}"
2. `constants.ts` gains `HOUR_MS`. `helpers.ts` gains:
   - `costBasis(split)`: the number of parts above 0 decides it — 0 → null, 1 → `billed` / `estimate` / `unknown`, more than 1 → `mixed`.
   - `splitLines(split)`: the non-zero parts in the order billed, estimate, unknown.
   - `signedCost(delta)`: `{ sign: "+" | "−" (U+2212) | "", amount: formatCost(Math.abs(delta)) }`, with no sign for 0.
   - `seriesUnit(series)`: `hour` when the second start minus the first is `HOUR_MS`, else `day`.
   - `spanDays(period)`: `Math.round((to − from) / DAY_MS)`.
3. `KpiCards` props become `{ summary, series, period, periodLabel }`.
   - Total runs card: the vendored `Sparkline` beside the total, inside `<div role="img" aria-label={t("kpi.series", { unit, peak })}>` (AC-58).
   - Total cost card: remove the estimate badge and note. Show the delta line `t("kpi.delta", { sign, amount, days })` (AC-60), or `kpi.noPrevious` (AC-61). Then the `splitLines` lines (AC-38), `kpi.billedNote` (AC-55), and `kpi.unpriced` unchanged (AC-39).
   - `AgentPerformanceView` passes `series={data.runs_series}` and `period={data.period}`.
Skills: `frontend-ui-architecture` → `placement.md` § "Utils, helpers, lib, services" (route-level `helpers.ts` shared by the siblings) and § Constants; `logic.md` § "The mechanical rule first" (no computation in JSX beyond calling helpers). `react-best-practices` → `SKILL.md`. `react-testing-library` → `SKILL.md` (queries by role and name; `fireEvent` only).
Tests to add:
- `KpiCards.test.tsx`: replace "marks the cost as an estimate (AC-38)" with: a 4.10 / 0.60 / 0 split shows "Billed $4.10" and "Estimate $0.60" and no "Unknown source" (AC-38); the note renders (AC-55); a delta of −1.20 over 30 days renders "−$1.20 vs previous 30d" (AC-60); a null delta renders "No earlier period to compare" and no signed amount (AC-61); the sparkline `path` `d` has one M/L command per bucket and the `img` name holds the peak (AC-58).
- `helpers.test.ts`: `costBasis` for the four kinds; `signedCost`; `seriesUnit`; `spanDays` on a 3-day DST range gives 3.
Done when: `.claude/agents/scripts/check-code.sh client -- KpiCards.test src/app/agent-performance/helpers.test.ts` passes with `Test Files 2`, and its typecheck line is green.

### Stage 7 — Table, breakdown, subtitle, removal of the estimate mark (client)
Track: client · After: 6
Files: `…/_components/AgentTable/AgentTable.tsx`, `styles.ts`, `AgentTable.test.tsx`, `…/_components/CostBreakdown/CostBreakdown.tsx`, `CostBreakdown.test.tsx`, `…/AgentPerformanceView/AgentPerformanceView.tsx`, `styles.ts`, `AgentPerformanceView.test.tsx`, `client/messages/en/agentPerformance.json`
Read first: `…/AgentTable/AgentTable.tsx`, `AgentTable/styles.ts`, `AgentTable.test.tsx:1-70`, `…/CostBreakdown/CostBreakdown.tsx`, `CostBreakdown.test.tsx`, `…/AgentPerformanceView/AgentPerformanceView.tsx`, `AgentPerformanceView/styles.ts`, `AgentPerformanceView.test.tsx:100-208`
Steps:
1. `AgentTable`:
   - Remove the header badge.
   - The Avg cost cell shows the amount followed by a muted `basis.*` word from `costBasis(r.cost_split)` when `avg_cost_usd` is not null (AC-53).
   - In the Accept rate cell, when `accept_trend` is `up` or `down`, render one `<span>` holding an `aria-hidden` "↑" or "↓" and the visible text `t("table.trendUp"/"trendDown", { rate: t("format.rate", { value: r.previous_accept_rate }) })` (AC-63, NFR-4). `flat` and null render nothing.
2. `CostBreakdown`:
   - Remove the header badge and note.
   - Each legend item gets a fourth grid column (`auto`) with the `basis.*` word of its segment's `cost_split`, beside the amount (AC-54).
   - Keep `TruncatedText` and `minmax(0, 1fr)`.
3. `AgentPerformanceView`: wrap the `h1` and a `<p>` holding `t("subtitle")` in one block of the header (AC-47).
4. Messages: delete the `estimate` block.
Skills: `react-best-practices` → `SKILL.md`. `frontend-ui-architecture` → `placement.md` § "Sub-component ownership" (`costBasis` comes from the route-level helpers, not from a sibling). `react-testing-library` → `SKILL.md`.
Tests to add:
- `AgentTable.test.tsx`: the AC-11 header test checks `heads[2]` is "Avg cost" (drop the "DevDigest estimate" check); four rows with the four kinds of split show "Billed", "Estimate", "Unknown source" and "Mixed" (AC-53); an `up` row shows "up from 64%", while `flat` and null rows have no arrow (AC-63).
- `CostBreakdown.test.tsx`: replace the `:41` assertion with a fully billed segment reading "Billed" and a mixed one reading "Mixed" (AC-54).
- `AgentPerformanceView.test.tsx`: the subtitle renders below the heading (AC-47). The existing AC-3…AC-6, AC-34…AC-36, AC-41, AC-44 and AC-45 cases stay green.
Done when: `.claude/agents/scripts/check-code.sh client` passes unfiltered, and `grep -rn "estimate\.mark\|estimate\.note\|cost_basis\|COST_BASIS" client/src client/messages server/src` prints nothing.

## 5. Skills matrix
| Stage | onion-architecture | typescript-expert | security | zod | drizzle-orm-patterns | postgresql-table-design | fastify-best-practices | frontend-ui-architecture | react-best-practices | react-testing-library |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `rules/domain-purity.md`, `rules/ports-and-di.md`, `rules/zod-contracts.md`, `rules/testing.md` | `SKILL.md` | `SKILL.md` § A08 | `SKILL.md` | | | | | | |
| 2 | `rules/drizzle-persistence.md`, `rules/testing.md` | | | | `references/schema-definition.md`, `references/migrations.md` | `SKILL.md` § Safe Schema Evolution, § Data Types | `rules/testing.md` | | | |
| 3 | `rules/zod-contracts.md` | | | `references/object-optional-vs-nullable.md`, `references/schema-use-enums.md`, `references/type-export-schemas-and-types.md` | | | | | | `SKILL.md` |
| 4 | `rules/domain-purity.md`, `rules/ports-and-di.md`, `rules/testing.md` | | | | | | | | | |
| 5 | `rules/drizzle-persistence.md`, `rules/layers.md`, `rules/testing.md` | | | | `references/queries-joins-aggregations.md` | | `rules/testing.md` | | | |
| 6 | | | | | | | | `placement.md`, `logic.md` | `SKILL.md` | `SKILL.md` |
| 7 | | | | | | | | `placement.md` | `SKILL.md` | `SKILL.md` |

## 6. Verification
| Package | Command (from the repository root) | Proves |
|---|---|---|
| reviewer-core | `.claude/agents/scripts/check-code.sh reviewer-core` | reviewer-core typecheck and tests, plus the server typecheck that compiles it: AC-48, AC-64, NFR-7, EC-26, EC-27, EC-29 |
| server | `.claude/agents/scripts/check-code.sh --it server` (Docker) | typecheck, depcruise (§3 rules), unit lane (AC-7, AC-49, helpers AC-52/56/57/59/62/65), integration lane (AC-50, AC-51, AC-52, AC-56, AC-57, AC-59, AC-62, AC-65, NFR-6, and the kept AC-20…AC-33, AC-40, AC-42, AC-46). Report the executed integration count, not just green. |
| server | calling session: the `/tmp` tsconfig recipe of `server/INSIGHTS.md` § Recurring Errors (with `typeRoots`) over `server/test/llm-cost-parts.test.ts`, `agent-performance-helpers.test.ts`, `agent-performance.it.test.ts`, `reviews.it.test.ts`, `helpers/eval.ts` | the new and changed server tests type-check (`pnpm typecheck` skips `test/**`) |
| client | `.claude/agents/scripts/check-code.sh client` | typecheck (tests included) and the whole suite: AC-38, AC-47, AC-53, AC-54, AC-55, AC-58, AC-60, AC-61, AC-63, and the kept AC-1…AC-19, AC-34…AC-37, AC-39, AC-41, AC-43…AC-46, NFR-3…NFR-5 |
| client | `pnpm build` in a copy of `client/` (`client/INSIGHTS.md` § Recurring Errors, when the dev stack runs) | NFR-2: type-only imports of `CostSplit` and the other contracts; `/agent-performance` builds |
| shared | the two `diff -u` contract checks of stage 3 and the `StructuredResult` `sed`/`diff` check of stage 1 | NFR-2: the copies did not drift |
| server | `grep -c 'ADD COLUMN' server/src/db/migrations/0020_*.sql` → 2; `grep -ciE 'UPDATE|DEFAULT|DROP' …` → 0 | NFR-6: the migration adds empty columns and writes nothing to existing rows |
| reviewer-core | `grep -rnE "from 'node:|process\.env" reviewer-core/src` → no new line | engine purity (root `INSIGHTS.md` § Tool & Library Notes, `^node:` entry) |
| server | `grep -rln "OpenRouterProvider\|completeStructured\|llm\." server/src/modules/agent-performance` → nothing | G-4, NFR-1: no model or OpenRouter call in the dashboard path (static) |

`./scripts/e2e.sh` is not needed: no main journey changes. NFR-1's live count diff waits until the user has applied `0020` (§7).

## 7. Risks and open questions
- [settled] Execution mode: multi-agent (§9).
- [settled: (a) `double precision`] Column type of `cost_billed_usd` / `cost_estimated_usd`. Options: (a) `double precision`, the type of `cost_usd`, which AC-50 says the parts add up to; (b) `numeric(p,s)`, as `postgresql-table-design/SKILL.md § Data Types` asks for money. Stage 2 waits; question 2.
- [non-blocking] Until the user applies `0020` to the dev DB, the dev API cannot use the new code paths. `completeAgentRun` sets two missing columns, so every review run on the dev stack ends in an error, and `GET /agents/performance` answers 500 ("column … does not exist"). Apply the migration before using the dev stack. Testcontainers is unaffected.
- [non-blocking] NFR-7 and the PriceBook. In a mixed call (one attempt billed, a re-ask not), the estimator is now called where today it was not. `PriceBook.estimate` (`server/src/platform/price-book.ts:33-38`) can start a background `/models` refresh once its 6 h cache has expired. This is the estimator's existing behaviour, not a new call path, and the unit test proves the provider request count is unchanged.
- [non-blocking] Floating-point sums. Splits are summed in SQL over `double precision`, so a split can differ from its figure by about 1e-15. Tests compare with `toBeCloseTo(…, 10)`.
- [non-blocking] EC-29 is a behaviour change in `openrouter.ts`. A call where one attempt has a reported cost and another has neither a cost nor a price now gives `costUsd: null`; today it gives the reported part alone. This is what EC-29 asks for.
- [→ researcher] Whether OpenRouter's `usage.cost` on a response includes provider-side retries. Only responses that reached DevDigest are billed (EC-30, the AC-55 note). This is open in `reviewer-core/INSIGHTS.md`, and nothing here depends on it.

## 8. Handoff to reviewers
- Architecture: the new `runsSeries` method on the consumer-declared `AgentPerformanceStore`; `estimatedOnly` lives in `adapters/llm/pricing.ts` (adapter ring), while the billed/estimated rule for OpenRouter lives in reviewer-core with the estimator still injected; the `StructuredResult` port change touches every `LLMProvider` (OpenRouter, OpenAI, Anthropic, the mock, the eval mock); `productionize.ts` gains an import from `observability.ts` (no cycle); and the `double precision` deviation (question 2).
- Security: UI-4 — `usage.cost` from a third party is accepted only as a finite number ≥ 0 before it reaches SQL and the screen. UI-1 — the series query binds `fromMs` and `bucketMs` as parameters. No new route, no new user input, no HTML rendering. Names stay rendered through `TruncatedText` as text (NFR-5, existing test).

## 9. Execution
Mode: multi-agent (recommended option; the user delegated the choice, 2026-10-17).
Recommended: multi-agent. After stage 3, the server half (stages 4–5) and the client half (6–7) have disjoint write sets and are each more than trivial edits. Stages 1–3 chain: each needs the previous one's output, and stage 3 turns the server typecheck red until stage 5.
| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| shared | 1–2 | `{server,client}/src/vendor/shared/adapters.ts`, `reviewer-core/src/llm/openrouter.ts`, `reviewer-core/src/review/run.ts`, `reviewer-core/test/**`, `server/src/adapters/llm/**`, `server/src/adapters/mocks.ts`, `server/test/helpers/eval.ts`, `server/test/llm-cost-parts.test.ts`, `server/src/db/schema/runs.ts`, `server/src/db/migrations/**` (generated only), `server/src/modules/reviews/{repository.ts,repository/run.repo.ts,run-executor.ts}`, `server/test/reviews.it.test.ts` | — | alone |
| shared | 3 | `{server,client}/src/vendor/shared/contracts/{observability,productionize}.ts`, the four client test files of stage 3 (fixtures only) | 1–2 | alone |
| server | 4–5 | `server/src/modules/agent-performance/**`, `server/test/agent-performance-helpers.test.ts`, `server/test/agent-performance.it.test.ts` | 3 | parallel |
| client | 6, then 7 | `client/messages/en/agentPerformance.json`, `client/src/app/agent-performance/**` | 3 | parallel |
| join | — | none: the calling session runs §6 unfiltered after both tracks | server, client | alone |

Briefs. One or two stages each, a fresh `implementer` per brief, in order inside a track:
- shared · stages 1–2 → "Execute stages 1–2 of specs/2026-10-17-agent-performance-dashboard-plan.md (track shared). Write only inside: the stage 1–2 write set of §9. Generate the migration with `pnpm db:generate` and never apply it. Check with: .claude/agents/scripts/check-code.sh reviewer-core; .claude/agents/scripts/check-code.sh --it server -- reviews.it."
- shared · stage 3 → "Execute stage 3 of specs/2026-10-17-agent-performance-dashboard-plan.md (track shared). Write only inside: the four contract files and the four client test files of stage 3 (fixtures only). Check with: the stage 3 diff commands; .claude/agents/scripts/check-code.sh client; .claude/agents/scripts/check-code.sh --no-tests server (errors only under modules/agent-performance expected)."
- server · stages 4–5 → "Execute stages 4–5 of specs/2026-10-17-agent-performance-dashboard-plan.md (track server). Write only inside: server/src/modules/agent-performance/**, server/test/agent-performance-helpers.test.ts, server/test/agent-performance.it.test.ts. Check with: .claude/agents/scripts/check-code.sh --it server."
- client · stage 6 → "Execute stage 6 of specs/2026-10-17-agent-performance-dashboard-plan.md (track client). Write only inside: client/messages/en/agentPerformance.json, client/src/app/agent-performance/{constants,helpers,helpers.test}.ts, …/KpiCards/**, and the <KpiCards> call in AgentPerformanceView.tsx. Check with: .claude/agents/scripts/check-code.sh client -- KpiCards.test src/app/agent-performance/helpers.test.ts."
- client · stage 7 → "Execute stage 7 of specs/2026-10-17-agent-performance-dashboard-plan.md (track client). Write only inside: …/AgentTable/**, …/CostBreakdown/**, …/AgentPerformanceView/{AgentPerformanceView.tsx,styles.ts,AgentPerformanceView.test.tsx}, client/messages/en/agentPerformance.json. Check with: .claude/agents/scripts/check-code.sh client."

single-agent: the same briefs, one after another: 1–2, 3, 4–5, 6, 7. The Runs column is not used.

## 10. Recommendations — not applied
- REC1 [approach] Add a check constraint on `agent_runs`: `(cost_billed_usd IS NULL) = (cost_estimated_usd IS NULL)`, and parts null when `cost_usd` is null. Why: AC-50 and AC-51 rely on "both parts or neither", and the repository's `unknown_usd` filter assumes it; today only application code enforces it (`postgresql-table-design/SKILL.md § Constraints`). Would change: stage 2 (schema extra config and the generated migration, which then also carries an `ADD CONSTRAINT`; the stage 2 `grep -c 'ADD COLUMN'` check stays at 2), plus one integration case that a mixed row is rejected.

## Questions for the user
The calling session asks these with AskUserQuestion and sends the answers back. The implementer does not start until every [blocking] one is answered.
1. [blocking] Execution mode: multi-agent or single-agent?
   - multi-agent (recommended): after the contract stage, the server and client halves run in parallel with disjoint write sets.
   - single-agent: five briefs in a row. It saves nothing on tokens and takes longer, with no merge risk avoided, because the parallel write sets are disjoint.
2. [blocking] Column type for the two stored cost parts (stage 2)?
   - `double precision` (recommended): the same type as `cost_usd`, so billed + estimated = `cost_usd` holds row by row (AC-50). It deviates from `postgresql-table-design`'s "Money: NUMERIC".
   - `numeric(p,s)`: follows the skill rule, but mixes types with `cost_usd`. Drizzle returns strings for it, and the parts would add up to `cost_usd` only within rounding.

Recommendations awaiting a decision: REC1 (§10). Accept it before implementation starts, or the plan stands as written.
There are no gaps for `spec-creator`: Step 2 found no defect in the requirements.
