# Implementation Plan — Agent Performance dashboard (SPEC-11)
Source: `specs/2026-10-17-agent-performance-dashboard.md` (Status: approved; `check-spec.sh` ok, 0 open questions) · Base: `79a6886` (`main`) · Branch: `feat/agent-performance-dashboard` · Packages: server, client

## 0. Before the first edit
- INSIGHTS: `server/INSIGHTS.md § Codebase Patterns`, "One review row per AGENT RUN … aggregate every row explicitly — never LIMIT 1" (:76-77). This leads to every figure being a GROUP BY over all counted runs. No "latest review" read anywhere.
- INSIGHTS: `server/INSIGHTS.md § Codebase Patterns`, "Findings are never deduplicated between runs" (:73). Each stored finding counts as its own decision (EC-13, DR-13). No dedup step.
- INSIGHTS: `server/INSIGHTS.md § Codebase Patterns`, "MockLLMProvider bills … costUsd 0.001 per call" (:82). The integration test seeds `agent_runs` rows directly with explicit costs and never starts a review. The mock provider is injected only to count calls (AC-40).
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes`, "`pnpm typecheck` does not look at `test/**`" (:111) plus the `/tmp` tsconfig recipe (:119-123). New server test files are type-checked by the calling session (section 6), never in an implementer's Done-when.
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes`, "`tsx watch` does not restart … under `src/vendor/`" (:99). For the live check after stage 1, restart the dev API.
- INSIGHTS: `server/INSIGHTS.md § What Doesn't Work`, the hermetic lane is pinned to an unreachable DB (:26). The AC-7 route test runs hermetically through `buildApp({ config })` like `test/routes-smoke.test.ts`.
- INSIGHTS: `client/INSIGHTS.md § What Doesn't Work`, "A bare ICU argument does not group digits" (:72). Every count goes through `{x, number}` / plural `#` (NFR-3).
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors`, "RunCostBadge … two text nodes of ONE span" (:103). Assert joined text or a regex in tests, never half of a multi-node element.
- INSIGHTS: `client/INSIGHTS.md § Open Questions`, "`common` namespace" (:124). Every test of this screen registers `{ agentPerformance, common }`, because Retry takes `common.actions.retry`.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors`, "@devdigest/shared is a TYPE-only dependency" (:97). The client imports `AgentPerf` with `import type` only. Period kinds are local literals.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors`, "grid child has min-width: auto" (:85). Grids and the table get `minmax(0, 1fr)` / `tableLayout: fixed` / `minWidth: 0` (AC-43). Take one screenshot of the real page (section 6).
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes`: `setDefaultOptions` drops `staleTime` (:45), `user-event` is not installed so use `fireEvent` (:54), client typecheck covers tests with `noUncheckedIndexedAccess` (:57), filter vitest by file name, not folder (:48), and `Chip` is a button (:63), so marks are `Badge`/`span`.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors`, "`pnpm build` overwrote `client/.next` under the running `next dev`" (:91). The NFR-2 build runs in a copy when the stack is up.
- INSIGHTS: root `INSIGHTS.md § Codebase Patterns`, "The starter pre-wires a course lesson" (:116). `client/messages/en/agentPerformance.json` already exists, with keys that differ from the spec. `activeKeyFor` already maps `/agent-performance` (`client/src/components/app-shell/helpers.ts:37`). `shell.nav.agent-performance` exists (`client/messages/en/shell.json:27`). Extend these; do not add a second namespace.
- INSIGHTS: root `INSIGHTS.md § What Works`, "To prove a screen made no model call, diff `agent_runs` / `run_traces`" (:46). This is the manual NFR-1 check in section 6.
- INSIGHTS: root `INSIGHTS.md § What Doesn't Work`, "run the whole package once every parallel track has landed" (:54) and "fresh implementer per one or two stages" (:75). This shapes sections 6 and 9.
- Read: `specs/2026-10-17-agent-performance-dashboard.md` (whole), `server/README.md § API map` (:60-90), `client/README.md § UI route map` (:19-45), `TESTING.md § Conventions`.

## 1. Scope — as the source states it
Pointers are `specs/2026-10-17-agent-performance-dashboard.md:<line>` (written `:<line>`). US-1…US-9 (`:38-46`) are covered through the criteria below.

Goals:
- G-1 A workspace member opens Agent Performance from the Global section of the sidebar and sees, for a chosen period, the runs, cost, duration, accept rate and last run of every agent, four KPI cards and a cost breakdown by agent and by model. — `:24`
- G-2 Every figure follows one written set of aggregation rules, shared with the per-agent stats, so that an agent's figures are equal in both places for the same period and every total equals the sum of its parts. — `:25`
- G-3 The screen tells apart loading, failure, a period with no run, an agent with no run, an accept rate from a small sample and a cost that is a DevDigest estimate — and never shows a made-up zero. — `:26`
- G-4 Opening and using the dashboard starts no review and no model call; it reads stored runs and findings only. — `:27`

Non-goals:
- NG-1 The agent Stats tab in the agent editor is not built; the per-agent figures are served by `GET /agents/:id/stats` only. — `:28`
- NG-2 No reconciled billing figure is shown. — `:29`
- NG-3 The runs sparkline, the cost delta against the previous period and the trend arrows in the Accept column are not built. — `:30`
- NG-4 The other Global items of the design — Memory, Multi-Agent Review, CI Runs — are not added. — `:31`
- NG-5 Eval runs (`eval_runs`) are not counted. — `:32`
- NG-6 No filter by repository. — `:33`
- NG-7 A table row does not expand; View opens the agent. — `:34`

Acceptance criteria:
- AC-1 The sidebar shall show an "Agent Performance" item, linking to `/agent-performance`, in a section titled "GLOBAL" placed after the Skills Lab section. — `:64` — clear (the nav group is missing at `client/src/vendor/ui/nav.ts:21-48`)
- AC-2 WHILE the current path is `/agent-performance`, the sidebar shall mark the Agent Performance item as the active item. — `:65` — partly already there: `activeKeyFor` maps it at `client/src/components/app-shell/helpers.ts:37`. Only the nav item is missing.
- AC-3 The Agent Performance screen shall offer three period choices: 1 day, 30 days and a custom date range. — `:66` — clear
- AC-4 WHEN the Agent Performance screen opens with no period in its URL, … shall select the 30 days period. — `:67` — clear
- AC-5 WHEN a period is selected, … shall request `GET /agents/performance` once with `from` and `to` of that period — 1 day is the 24 hours before now, 30 days the 30 × 24 hours before now, a custom range runs from the start of its first local date to the start of the local date after its last. — `:68` — clear
- AC-6 IF a custom range ends before it starts, or ends after today, THEN … shall show a validation message at the range picker and send no request. — `:69` — clear
- AC-7 IF `GET /agents/performance` or `GET /agents/:id/stats` is called without `from` or `to`, with a value that is not an ISO 8601 date-time, or with `from` not before `to`, THEN the API shall answer 422. — `:70` — clear
- AC-8 WHEN the response arrives, … shall show four cards — Total runs, Total cost, Avg accept rate, Most-active agent — filled from `summary`, each label naming the selected period. — `:71` — clear
- AC-9 The Avg accept rate card shall show, beside the rate, the number of decisions it is computed from and the number of runs counted in the period. — `:72` — clear
- AC-10 The Most-active agent card shall show that agent's name, its counted runs and its accept rate. — `:73` — clear
- AC-11 … a table with the columns Agent, Runs, Avg cost, Avg duration, Accept rate, Last run and View, with one row per entry of `agents`. — `:74` — clear
- AC-12 The Accept rate cell … shall show the rate together with its denominator as a number of decisions. — `:75` — clear
- AC-13 WHILE an agent has fewer than 10 decisions in the period, … shall show a "small sample" text mark in that agent's Accept rate cell. — `:76` — clear
- AC-14 WHEN the table is sorted by Accept rate, … shall order the rows that are not a small sample by their rate and place every small-sample row and every row without a rate after them. — `:77` — clear
- AC-15 WHEN the table first renders, … shall sort it by Accept rate, highest first. — `:78` — clear
- AC-16 WHEN the user activates View on a row, … shall navigate to `/agents/<agent_id>` of that row. — `:79` — clear
- AC-17 WHILE a row stands for the runs of deleted agents (`agent_id` null), … shall show "Deleted agent" as its name and no View control. — `:80` — clear
- AC-18 … a Cost breakdown section with two charts, By agent and By model, each with a legend naming every segment and its amount. — `:81` — clear
- AC-19 WHILE no run counted in the period has a cost, … shall show "No cost recorded for this period" in place of both charts. — `:82` — clear (see REC3)
- AC-20 The API shall count a review run (`agent_runs`; eval runs are not review runs) when it belongs to the caller's workspace, its `ran_at` lies in the half-open range [`from`, `to`) and its status is `done`, `failed` or `cancelled`. — `:83` — clear
- AC-21 … an agent's `total_cost_usd` the sum of `cost_usd` over its counted runs that have a cost, and as `avg_cost_usd` that sum divided by the number of those runs. — `:84` — clear
- AC-22 … an agent's `avg_latency_ms` the mean `duration_ms` of its counted runs whose status is `done`. — `:85` — clear
- AC-23 … an agent's `accepted` and `dismissed` the findings (of every kind) of the reviews produced by its counted runs that carry `accepted_at` or `dismissed_at`, whenever the decision was made, as `decisions` their sum, and as `accept_rate` accepted divided by decisions (null when decisions is 0). — `:86` — clear
- AC-24 … a `summary.total_cost_usd` equal to the sum of `total_cost_usd` over `agents`, to the sum of `cost_by_agent` and to the sum of `cost_by_model`. — `:87` — clear
- AC-25 … group `cost_by_model` by the `model` stored on each run, not by the agent's current model. — `:88` — clear
- AC-26 … `summary.runs` as the number of counted runs and `summary.most_active_agent` as the agent with the most counted runs, ties going to the agent with the newer last run, and null when no run is counted. — `:89` — clear. The deleted-agents row is "the runs of deleted agents" (AC-17), not an agent, so it is never the most-active agent. See section 7 for the card when every run belongs to deleted agents.
- AC-27 … `summary.avg_accept_rate` as the sum of `accepted` over all rows divided by the sum of `decisions`, null when that sum is 0. — `:90` — clear
- AC-28 … list in `agents` every agent of the workspace, enabled or not, an agent with no counted run having `runs` 0 and null `accept_rate`, `avg_cost_usd`, `avg_latency_ms` and `last_run_at`. — `:91` — clear
- AC-29 … gather the counted runs whose agent was deleted into one `agents` row and one `cost_by_agent` segment with `agent_id` null, included in every total. — `:92` — clear
- AC-30 … per agent and in `summary`, `unpriced_runs` as the number of counted runs that have no cost. — `:93` — clear
- AC-31 … count the runs of every repository of the caller's workspace and no run, review or finding of another workspace. — `:94` — clear
- AC-32 WHEN `GET /agents/:id/stats` is called with `from` and `to`, the API shall return `runs`, `total_cost_usd`, `avg_cost_usd`, `avg_latency_ms`, `accepted`, `dismissed` and `accept_rate` equal to that agent's row of `GET /agents/performance` for the same `from` and `to`. — `:95` — clear
- AC-33 IF `GET /agents/:id/stats` names an agent that is not in the caller's workspace, THEN the API shall answer 404. — `:96` — clear
- AC-34 WHILE the response for the selected period has not arrived, … shall show placeholders without any number in place of the cards, the table and the breakdown. — `:97` — clear
- AC-35 IF the request fails, THEN … shall show an error message and a Retry control, without any number, in place of the cards, the table and the breakdown. — `:98` — clear
- AC-36 WHILE the response counts no run in the period (`summary.runs` 0), … shall show one empty state naming the period in place of the cards, the table and the breakdown. — `:99` — clear
- AC-37 WHILE at least one run is counted and an agent has none, … shall show "No runs in this period" across that agent's figure cells, keeping its name and View. — `:100` — clear
- AC-38 … shall mark the Total cost card, the Avg cost column and the Cost breakdown as "DevDigest estimate", with a note that the figures are computed by DevDigest from provider-reported or price-table costs and are not billing data. — `:101` — clear
- AC-39 WHILE `summary.unpriced_runs` is above 0, … shall state on the Total cost card how many counted runs the total leaves out. — `:102` — clear
- AC-40 The API shall answer `GET /agents/performance` and `GET /agents/:id/stats` without calling a model provider and without writing a row to any table. — `:103` — clear
- AC-41 … shall send only GET requests while it loads, reloads, changes period, sorts or opens an agent. — `:104` — clear
- AC-42 … an agent's `last_run_at` the newest `ran_at` among its counted runs. — `:105` — clear
- AC-43 … shall cut a long agent name or model name with an ellipsis inside its cell or legend, show it in full on hover and focus, and keep the page from scrolling sideways. — `:106` — clear
- AC-44 WHEN a period is selected, … shall write that period into the URL query of `/agent-performance`. — `:107` — clear
- AC-45 WHEN the Agent Performance screen opens with a valid period in its URL, … shall select that period and request it. — `:108` — clear
- AC-46 The API shall put the cost of counted runs that have no stored `model` into one `cost_by_model` segment with `label` null, which the Agent Performance screen names "Unknown model". — `:109` — clear

Edge cases (each one maps to the criteria named in the source): EC-1 `:113` → AC-36 · EC-2 `:114` → AC-28, AC-37 · EC-3 `:115` "shown with '0 decisions' and sorted after the rated rows" → AC-23, AC-14 · EC-4 `:116` → AC-13, AC-14 · EC-5 `:117` → AC-21, AC-30, AC-39 · EC-6 `:118` → AC-19 · EC-7 `:119` → AC-17, AC-29 · EC-8 `:120` → AC-20 · EC-9 `:121` → AC-22 · EC-10 `:122` → AC-25 · EC-11 `:123` → AC-46 · EC-12 `:124` → AC-23 · EC-13 `:125` → AC-23 · EC-14 `:126` → AC-26 · EC-15 `:127` → AC-20 · EC-16 `:128` → AC-6 · EC-17 `:129` → AC-7 · EC-18 `:130` "every agent is listed … with no cap and no paging" → AC-28 · EC-19 `:131` → AC-20 · EC-20 `:132` "the placeholders of the new period, never the old period's numbers under the new label" → AC-34 · EC-21 `:133` → AC-43

Non-functional:
- NFR-1 Neither route nor the screen starts a review or calls a model provider; the number of `agent_runs` and `run_traces` rows is the same before and after any use of the dashboard. — `:137`
- NFR-2 The changes to `AgentPerf`, `AgentPerfRow`, `PerfCostSegment` and `AgentStats` land identically in both contract copies; lines in which the two copies already differ (`productionize.ts:36`) stay as they are; the client imports these contracts as types only. — `:138`
- NFR-3 Every visible string of the screen comes from `client/messages/en/`; every count and amount above 999 is rendered with digit grouping and costs in USD. — `:139`
- NFR-4 The period picker, the Accept rate sort control, Retry and every View are native buttons or links reachable by keyboard with an accessible name; the sorted header exposes `aria-sort`; the small-sample mark and every chart segment are carried by text, not by colour alone. — `:140`
- NFR-5 Agent names and model names are rendered as text, never as HTML and never as a link target; the only link of a row is built from `agent_id`. — `:141`

Contract (wire shape) as stated: `:174-208`. Fields `AgentPerfRow` declares and no criterion names "are not required by this spec" (`:201-203`).

## 2. Impact map
| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| server + client | `server/src/vendor/shared/contracts/productionize.ts`, `client/src/vendor/shared/contracts/productionize.ts` | Modify | shared contract (both copies) | NFR-2, AC-13, 17, 24, 26, 29, 30, 46 |
| server + client | `server/src/vendor/shared/contracts/observability.ts`, `client/src/vendor/shared/contracts/observability.ts` | Modify | shared contract (both copies) | AC-32, NFR-2 |
| server | `server/src/modules/agent-performance/types.ts` | New | ports and stored shapes (consumer-declared) | AC-20…33 |
| server | `server/src/modules/agent-performance/constants.ts` | New | pure constants | AC-13, 20 |
| server | `server/src/modules/agent-performance/helpers.ts` | New | pure aggregation (no I/O) | AC-21…30, 32, 42, 46 |
| server | `server/src/modules/agent-performance/repository.ts` | New | driven adapter (Drizzle, read-only) | AC-20, 23, 25, 31, 40 |
| server | `server/src/modules/agent-performance/service.ts` | New | application service | AC-32, 33 |
| server | `server/src/modules/agent-performance/routes.ts` | New | driving adapter (2 GET routes) | AC-7, 33, 40 |
| server | `server/src/modules/index.ts` | Modify | module registry | — |
| server | `server/src/platform/container.ts` | Modify | composition root (2 lazy getters) | — |
| server | `server/test/agent-performance-helpers.test.ts` | New | hermetic, pure | AC-24, 26, 27, 29, 13 |
| server | `server/test/agent-performance-routes.test.ts` | New | hermetic, `app.inject()` | AC-7 |
| server | `server/test/agent-performance.it.test.ts` | New | DB-backed (testcontainers) | AC-20…33, 40, 42, 46 |
| server | `server/README.md` | Modify | docs (§ API map) | — |
| client | `client/src/vendor/ui/nav.ts` | Modify | design system nav registry | AC-1, 2 |
| client | `client/src/components/app-shell/navigation.test.tsx` | Modify | test | AC-1, 2 |
| client | `client/messages/en/agentPerformance.json` | Modify (pre-wired namespace) | copy | NFR-3, AC-8…19, 36…39, 46 |
| client | `client/src/lib/hooks/agents.ts` | Modify (add hook) | data access | AC-5, 41 |
| client | `client/src/app/agent-performance/constants.ts`, `helpers.ts`, `helpers.test.ts` | New | route-level shared helpers | AC-4…6, 14, 44, 45, NFR-3 |
| client | `client/src/vendor/ui/charts/Donut.tsx` | Modify (optional `hideLegend`) | design system | AC-18, 43 |
| client | `client/src/app/agent-performance/_components/TruncatedText/` | New | route-level, shared by two siblings | AC-43, NFR-5 |
| client | `client/src/app/agent-performance/_components/AgentPerformanceView/` (`AgentPerformanceView.tsx`, `index.ts`, `styles.ts`, test) | New | route container | AC-3…6, 34…36, 41, 44, 45 |
| client | `…/AgentPerformanceView/_components/PeriodPicker/` | New | child of the view | AC-3, 6, NFR-4 |
| client | `…/AgentPerformanceView/_components/KpiCards/` | New | child of the view | AC-8, 9, 10, 38, 39 |
| client | `…/AgentPerformanceView/_components/AgentTable/` | New | child of the view | AC-11…17, 37, 38, 43, NFR-4, 5 |
| client | `…/AgentPerformanceView/_components/CostBreakdown/` | New | child of the view | AC-18, 19, 38, 43, 46 |
| client | `client/src/app/agent-performance/page.tsx` | New | thin route | AC-1 target |
| client | `client/README.md` | Modify | docs (§ UI route map) | — |

## 3. Constraints in play
- dependency-cruiser (`server/.dependency-cruiser.cjs`) must stay green. Rules in play: `drizzle-only-in-repositories` and `schema-only-in-repositories` (Drizzle and `db/schema` only in `agent-performance/repository.ts`), `no-row-types-in-transport`, `no-cross-module-internals` (no import of `agents/repository.ts` or `reviews/repository/*`; the new repository reads the shared tables `agents`, `agent_runs`, `reviews`, `findings` itself, as `reviews/repository/run.repo.ts:15-23` joins `t.agents`), `no-service-to-container`, `no-circular`.
- Routes are static versus parametric: `GET /agents/performance` (new plugin) and `GET /agents/:id` (agents plugin, `IdParams` uuid) share the router. find-my-way prefers the static segment, so `/agents/performance` never reaches `IdParams`. The integration test proves it with a 200.
- Dual contract copy: one stage edits both copies byte-identically in the touched schemas. The existing `PluginAgent.provider` difference at `productionize.ts:36` stays. The client imports `type` only.
- Contract decision (the source leaves it open, `:201-203`): fields declared but not required (`AgentPerfRow.provider`, `model`, `findings_total`, `dismiss_rate`, `avg_findings_per_run`, `findings_by_severity`, `trend`; `AgentStats.findings_total`, `pending`, `dismiss_rate`, `avg_findings_per_run`, `findings_by_severity`, `trend`) become `.optional()`, and the server omits them. Deleting them instead is REC2.
- No migration, no new dependency, no feature-model row. The routes start no job and never touch `container.llm`.
- Naming: module `server/src/modules/agent-performance/` (kebab-case), plugin key `agentPerformance`. Client route `/agent-performance`, components in PascalCase folders with `index.ts`. Wire snake_case, TS camelCase.
- i18n: all screen copy goes in the pre-wired `client/messages/en/agentPerformance.json` (rewritten to the spec's wording; no other file reads it — `grep -rn agentPerformance client/src` is empty at base). Retry comes from `common.actions.retry`. Sidebar labels live in `nav.ts`, as every other nav item does.
- Tests: `*.test.ts(x)` beside the code. DB-backed server tests end in `*.it.test.ts`. One happy path plus the edges that matter.

## 4. Stages

### Stage 1 — Contracts in both copies
Track: shared · After: —
Files: `server/src/vendor/shared/contracts/productionize.ts`, `client/src/vendor/shared/contracts/productionize.ts`, `server/src/vendor/shared/contracts/observability.ts`, `client/src/vendor/shared/contracts/observability.ts`
Read first: `server/src/vendor/shared/contracts/productionize.ts:130-190` (AgentPerfRow, PerfCostSegment, AgentPerf), `server/src/vendor/shared/contracts/observability.ts:86-120` (AgentStats). The client copies are identical in these ranges.
Steps:
1. `AgentPerfRow`: `agent_id: z.string().nullable()`, `agent_name: z.string().nullable()`. Add `decisions: z.number().int()`, `unpriced_runs: z.number().int()`, `small_sample: z.boolean()`. Mark `provider`, `model`, `findings_total`, `dismiss_rate`, `avg_findings_per_run`, `findings_by_severity`, `trend` `.optional()` and keep their current inner types. Keep `runs`, `accepted`, `dismissed`, `accept_rate`, `total_cost_usd`, `avg_cost_usd`, `avg_latency_ms`, `last_run_at` as declared. Update the doc comments ("null for the deleted-agents row").
2. `PerfCostSegment`: `label: z.string().nullable()` (agent name or stored model; null for deleted agents and for runs without a model), `value: z.number().positive()`.
3. `AgentPerf`: add `period: z.object({ from: z.string(), to: z.string() })`, `cost_basis: z.literal('estimate')`, `min_decisions: z.number().int()`. Extend `summary` with `unpriced_runs`, `accepted`, `decisions` (int), `most_active_agent_id: z.string().nullable()`, `most_active_runs: z.number().int()`, `most_active_accept_rate: z.number().nullable()`. Use `cost_by_agent: z.array(PerfCostSegment.extend({ agent_id: z.string().nullable() }))` and leave `cost_by_model: z.array(PerfCostSegment)`.
4. `AgentStats`: add `period` (same shape), `decisions`, `unpriced_runs` (int). Mark `findings_total`, `pending`, `dismiss_rate`, `avg_findings_per_run`, `findings_by_severity`, `trend` `.optional()`. Keep `agent_id`, `agent_name` (string), `runs`, `accepted`, `dismissed`, `accept_rate`, `total_cost_usd`, `avg_cost_usd`, `avg_latency_ms`.
5. Apply exactly the same text to both copies. Do not touch `PluginAgent.provider` (`:36`).
Skills: `zod` → `.claude/skills/zod/references/object-optional-vs-nullable.md` (`.optional()` for an omitted field, `.nullable()` for an explicit null); `onion-architecture` → `rules/zod-contracts.md` (contracts are the wire shape, one schema per name, type of the same name).
Tests to add: none (no behaviour). Covered by stages 3–4 serialization and the drift check.
Done when: `diff -u server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts` prints nothing; `diff -u server/src/vendor/shared/contracts/productionize.ts client/src/vendor/shared/contracts/productionize.ts` prints only the existing hunk at line 36; `.claude/agents/scripts/check-code.sh --no-tests server client reviewer-core` passes.

### Stage 2 — Pure aggregation rules (server)
Track: server · After: 1
Files: `server/src/modules/agent-performance/types.ts`, `constants.ts`, `helpers.ts`, `server/test/agent-performance-helpers.test.ts`
Read first: `server/src/modules/brief/types.ts:60-117` (consumer-declared port pattern), `server/src/modules/eval/constants.ts` (constants file shape), `server/src/vendor/shared/contracts/productionize.ts:135-190` (after stage 1), `server/src/vendor/shared/contracts/observability.ts:88-125`, `server/test/brief-helpers.test.ts` (hermetic helper test pattern)
Steps:
1. `constants.ts`: `MIN_DECISIONS = 10` (AC-13), `COUNTED_STATUSES = ['done', 'failed', 'cancelled'] as const` (AC-20), `LATENCY_STATUS = 'done'` (AC-22), `COST_BASIS = 'estimate' as const`.
2. `types.ts`:
   - `PerfRange { from: Date; to: Date }`, `AgentRef { id: string; name: string }`.
   - `RunAggregate { agentId: string | null; runs: number; pricedRuns: number; totalCostUsd: number | null; avgLatencyMs: number | null; lastRunAt: Date | null }`.
   - `DecisionAggregate { agentId: string | null; accepted: number; dismissed: number }`, `ModelCost { model: string | null; costUsd: number }`.
   - The port `AgentPerformanceStore { listAgents(ws): Promise<AgentRef[]>; getAgent(ws, id): Promise<AgentRef | undefined>; runAggregates(ws, range, agentId?): Promise<RunAggregate[]>; decisionAggregates(ws, range, agentId?): Promise<DecisionAggregate[]>; costByModel(ws, range): Promise<ModelCost[]> }`.
   - `AgentPerformanceDeps { readonly store: AgentPerformanceStore }`.
3. `helpers.ts`, all pure:
   - `toRowFigures(run: RunAggregate | undefined, dec: DecisionAggregate | undefined)` → `{ runs, unpriced_runs = runs − pricedRuns, total_cost_usd, avg_cost_usd = pricedRuns ? total / pricedRuns : null, avg_latency_ms, last_run_at (ISO | null), accepted, dismissed, decisions, accept_rate = decisions ? accepted / decisions : null, small_sample = decisions < MIN_DECISIONS }`. This one function serves both routes (AC-32). With no run it returns runs 0 and nulls (AC-28).
   - `buildPerformance(agents, runs, decisions, modelCosts, range): AgentPerf`:
     - One row per agent of `agents` (enabled or not). One deleted-agents row (`agent_id`/`agent_name` null) only when a run aggregate has `agentId` null. A run or decision aggregate whose `agentId` is not in `agents` (an agent deleted between the two reads) folds into that row, so totals stay whole (AC-29).
     - Order rows by name ascending, deleted row last.
     - `cost_by_agent`: one segment per row with `total_cost_usd > 0`, `label` = row name (null for deleted), `agent_id` = row id, sorted by value descending.
     - `cost_by_model`: `modelCosts` filtered to `costUsd > 0`, `label` = model (null when no model, AC-46), sorted by value descending.
     - `summary`:
       - `runs` = Σ runs; `unpriced_runs` = Σ; `accepted`, `decisions` = Σ.
       - `total_cost_usd` = Σ row totals, or null when every row total is null (AC-24, AC-19).
       - `avg_accept_rate` = Σaccepted / Σdecisions, or null (AC-27).
       - Most-active: among rows with `agent_id !== null && runs > 0`, the max runs; ties go to the newer `last_run_at`, then name ascending. Fill `most_active_agent`, `most_active_agent_id`, `most_active_runs`, `most_active_accept_rate`. When there is none: null, null, 0, null (AC-26).
     - `period` = `{ from: range.from.toISOString(), to: range.to.toISOString() }`, `cost_basis: 'estimate'`, `min_decisions: MIN_DECISIONS`.
   - `buildStats(agent: AgentRef, run, dec, range): AgentStats` = `toRowFigures` plus `agent_id`, `agent_name`, `period`.
Skills: `onion-architecture` → `rules/layers.md` (a rule that needs no I/O lives in a pure helper, testable without Postgres; OA-9) and `rules/ports-and-di.md` § "A port is defined by the consumer" (the store interface lives in the module's `types.ts`); `onion-architecture` → `rules/testing.md` (pure inputs, no doubles, hermetic name).
Tests to add: `server/test/agent-performance-helpers.test.ts`. It proves that two agents plus a deleted group, two models and an unpriced run give `summary.total_cost_usd` equal to Σ rows = Σ `cost_by_agent` = Σ `cost_by_model` with `toBeCloseTo` (AC-24, AC-29, AC-30). It also covers: 9/10 and 1/2 decisions → 10/12 (AC-27); a runs tie resolved by the newer `last_run_at`, an empty input → null most-active and null total (AC-26); 9 decisions → `small_sample` true, 10 → false (AC-13); no decisions → `accept_rate` null (AC-23); a zero-run agent → runs 0 and null figures (AC-28).
Done when: `.claude/agents/scripts/check-code.sh server -- agent-performance-helpers` passes.

### Stage 3 — Repository, service, routes, wiring (server)
Track: server · After: 2
Files: `server/src/modules/agent-performance/repository.ts`, `service.ts`, `routes.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/test/agent-performance-routes.test.ts`
Read first: `server/src/modules/brief/routes.ts` (thin route over `app.container.<x>Service`), `server/src/modules/eval/routes.ts:185-222` (`querystring` + `response` schemas), `server/src/modules/agents/routes.ts:59-84` (`.refine` on a schema, `NotFoundError`), `server/src/modules/reviews/repository/run.repo.ts:1-40` (select over `t.agentRuns` with `t.agents`), `server/src/modules/eval/repository.ts:492-579` (grouped aggregates, `count()`, `sql` FILTER-style expressions), `server/src/platform/container.ts:30-50,105-135,268-300`, `server/src/modules/index.ts`, `server/src/app.ts:128-165` (validation → 422), `server/src/platform/errors.ts:1-30`, `server/test/routes-smoke.test.ts:1-20`
Steps:
1. `repository.ts`: `class AgentPerformanceRepository implements AgentPerformanceStore`, constructor `(private db: Db)`. Every query is a read with bound parameters. Postgres returns `count` and `avg` as strings through postgres.js, so map them with `Number()`.
   - `listAgents(ws)`: `select id, name from agents where workspace_id = ws`. No `enabled` filter (AC-28).
   - `getAgent(ws, id)`: the same query plus `eq(agents.id, id)`.
   - `runAggregates(ws, range, agentId?)`: from `agent_runs` where `workspace_id = ws and ran_at >= from and ran_at < to and status in COUNTED_STATUSES` (plus `agent_id = agentId` when given), `group by agent_id`. It selects:
     - `count(*)` runs, `count(cost_usd)` priced, `sum(cost_usd)` total;
     - `avg(duration_ms) filter (where status = 'done')`;
     - `max(ran_at)`.
   - `decisionAggregates(ws, range, agentId?)`: `agent_runs ar join reviews r on r.run_id = ar.id and r.workspace_id = ws join findings f on f.review_id = r.id`, with the same run filter. It selects `count(*) filter (where f.accepted_at is not null)` and `count(*) filter (where f.dismissed_at is not null)` grouped by `ar.agent_id`. There is no condition on the decision time (AC-23, EC-12) and none on `f.kind`.
   - `costByModel(ws, range)`: the same run filter plus `cost_usd is not null`, `group by model`, `sum(cost_usd)` (AC-25, AC-46).
   - Map rows to the `types.ts` shapes at the edge. No `$inferSelect` leaves the file (OA-5).
2. `service.ts`: `class AgentPerformanceService { constructor(private readonly deps: AgentPerformanceDeps) }`.
   - `performance(ws, range): Promise<AgentPerf>` reads the four store results (in parallel) → `buildPerformance`.
   - `agentStats(ws, agentId, range): Promise<AgentStats>`: `getAgent` → `NotFoundError('Agent not found')` when undefined (AC-33). Then `runAggregates` and `decisionAggregates` with `agentId` → `buildStats`.
   - No `llm`, no `jobs` in the deps (AC-40).
3. `routes.ts`, default plugin `agentPerformanceRoutes`, `service = app.container.agentPerformanceService`.
   - `PeriodQuery = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).refine((q) => Date.parse(q.from) < Date.parse(q.to), { message: 'from must be before to', path: ['from'] })` (AC-7).
   - `GET /agents/performance` with `{ querystring: PeriodQuery, response: { 200: AgentPerf } }`.
   - `GET /agents/:id/stats` with `{ params: IdParams, querystring: PeriodQuery, response: { 200: AgentStats } }`.
   - Each handler: `getContext` → one service call with `{ from: new Date(req.query.from), to: new Date(req.query.to) }`.
4. `container.ts`: lazy getters `agentPerformanceRepo` (`new AgentPerformanceRepository(this.db)`) and `agentPerformanceService` (`new AgentPerformanceService({ store: this.agentPerformanceRepo })`), next to `briefRepo` / `briefService`.
5. `modules/index.ts`: one import and the entry `agentPerformance`.
Skills:
- `fastify-best-practices` → `rules/schemas.md` (querystring and response schemas on the route) and `rules/routes.md`.
- `onion-architecture` → `rules/fastify-transport.md` (a route calls one service method), `rules/errors.md` (`NotFoundError`, OA-10), `rules/drizzle-persistence.md` (Drizzle only in `repository.ts`, rows mapped at the edge, data-operation method names), `rules/ports-and-di.md` (the service takes `{ store }`, not `Container`; `new` only in the container).
- `drizzle-orm-patterns` → `references/queries-joins-aggregations.md` § Joins, § Aggregations.
- `zod` → `references/schema-string-validations.md` (`datetime({ offset: true })`), `references/refine-add-path.md`.
- `security` → `SKILL.md` (content trigger `.query.`): query values parsed before the handler and bound as parameters, `:id` workspace-scoped (UI-1, UI-2).
- `fastify-best-practices` → `rules/testing.md` (`.inject(`).
Tests to add: `server/test/agent-performance-routes.test.ts` (hermetic; `buildApp({ config })` as in `routes-smoke.test.ts`). Each of these answers 422 on both routes: `from` missing, `to` missing, `from=yesterday`, `from == to`, `from > to`. `/agents/not-a-uuid/stats` also answers 422 (AC-7).
Done when: `.claude/agents/scripts/check-code.sh server` passes (typecheck, depcruise, unit lane).

### Stage 4 — Integration test of the counting rules + API map (server)
Track: server · After: 3
Files: `server/test/agent-performance.it.test.ts`, `server/README.md`
Read first: `server/test/pulls-cost.it.test.ts:1-90` (testcontainers setup, seeding `agent_runs` directly, `buildApp` + `inject`), `server/test/agents-versions.it.test.ts:150-178` (a second workspace), `server/test/helpers/pg.ts:1-40`, `server/src/adapters/mocks.ts:58-95` (`MockLLMProvider.calls`), `server/src/db/schema/runs.ts`, `server/src/db/schema/reviews.ts:1-48`, `server/README.md:60-90`
Steps:
1. One `describe` gated on `dockerAvailable()`, `startPg()` + `seed()` in `beforeAll`. Use a far-past window (e.g. `2026-01-01T00:00:00Z`–`2026-02-01T00:00:00Z`) that no seeded row touches. Seeded agents have no runs, which itself shows AC-28.
2. Insert helper agents through `t.agents`. Insert runs through `t.agentRuns` with explicit `status`, `ranAt`, `costUsd`, `model`, `durationMs`. Insert reviews with `runId` and findings carrying `acceptedAt` / `dismissedAt` / neither, with `kind` `'finding'` and one other value.
3. Build the app with `overrides: { llm: { openai: mock, anthropic: mock2 } }` (two `MockLLMProvider`s) to count calls.
4. Cases, one `it` each:
   - Runs at exactly `from` (counted) and at `to` (not counted); one `running`; one `eval_runs` row for the agent. `runs` must match (AC-20, EC-8, EC-15, EC-19).
   - Costs `0.004`, `0.012`, `null` → `total_cost_usd` 0.016, `avg_cost_usd` 0.008, `unpriced_runs` 1 (AC-21, AC-30).
   - Done 1000 ms and 3000 ms plus failed 0 ms → `avg_latency_ms` 2000 (AC-22).
   - Accepted, dismissed and undecided findings of both kinds, one accepted after `to` → expected counts and rate (AC-23).
   - Two agents, two models, one deleted agent (`DELETE /agents/:id` after its runs) → `agents` row with `agent_id` null, `cost_by_agent` segment, `summary.runs`; the four sums agree with `toBeCloseTo` (AC-24, AC-29).
   - One agent with runs on two `model` values → two model segments (AC-25).
   - A priced run with `model: null` → segment `label` null, sums still agree (AC-46).
   - A runs tie → the newer last run wins; an empty window → `most_active_agent` null (AC-26).
   - A run outside the window does not move `last_run_at` (AC-42).
   - A disabled agent with no run is listed with `runs` 0 and nulls (AC-28).
   - Rows seeded in a second workspace leave every figure unchanged (AC-31).
   - For every agent row, `GET /agents/:id/stats` with the same `from`/`to` equals the row on the seven fields (AC-32).
   - An unknown uuid and another workspace's agent id give 404 (AC-33).
   - Counts of `agent_runs` and `run_traces` before and after both calls are equal, and both mocks have `calls.length === 0` (AC-40).
5. `server/README.md § API map`: add an `agentPerformance` node "agent-performance<br/>GET /agents/performance · GET /agents/:id/stats (from, to; read-only)" under the Agents subgraph.
Skills: `onion-architecture` → `rules/testing.md` (driven adapter against the real DB, `*.it.test.ts` suffix); `fastify-best-practices` → `rules/testing.md` (`app.inject()`).
Tests to add: as above. This file is the evidence for AC-20…AC-33, AC-40, AC-42, AC-46.
Done when: `.claude/agents/scripts/check-code.sh --it server -- agent-performance` passes with the `.it` file executed, not skipped (report the count).

### Stage 5 — Nav item, copy, hook, period and sort helpers (client)
Track: client · After: 1
Files: `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/navigation.test.tsx`, `client/messages/en/agentPerformance.json`, `client/src/lib/hooks/agents.ts`, `client/src/app/agent-performance/constants.ts`, `client/src/app/agent-performance/helpers.ts`, `client/src/app/agent-performance/helpers.test.ts`
Read first: `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/navigation.test.tsx`, `client/src/components/app-shell/helpers.ts:26-40`, `client/messages/en/agentPerformance.json`, `client/src/lib/hooks/agents.ts:1-30`, `client/src/components/run-cost/helpers.ts`, `client/src/components/eval-runs/helpers.ts:1-35` (`toPercent`, `formatRunTime`), `client/src/app/repos/[repoId]/pulls/constants.ts` (route-level helper precedent)
Steps:
1. `nav.ts`: append `{ section: "GLOBAL", items: [{ key: "agent-performance", label: "Agent Performance", icon: "BarChart", href: "/agent-performance" }] }` after SKILLS LAB. No `gKey`.
2. `navigation.test.tsx`: add a `describe("Agent Performance navigation")`. It checks that the "GLOBAL" heading follows the last SKILLS LAB item and that the link `/agent-performance` is named "Agent Performance" (AC-1). It also checks that `activeKeyFor("/agent-performance")` is `"agent-performance"` and that the item has `fontWeight: 600` while "Agents" and "Eval Dashboard" have 500 (AC-2).
3. Rewrite `agentPerformance.json`. These keys are its whole content; drop the old keys, which nothing reads. Strings quoted in the spec are used verbatim.
   - Header: `title` "Agent Performance".
   - `period.label` "Period"; `period.choices.1d` "1 day"; `period.choices.30d` "30 days"; `period.choices.custom` "Custom range"; `period.short.1d` "1d"; `period.short.30d` "30d"; `period.short.custom` "{start} – {end}".
   - `period.custom.start` "From"; `period.custom.end` "To"; `period.custom.apply` "Apply"; `period.custom.inverted` "The range ends before it starts."; `period.custom.future` "The range cannot end after today."
   - `kpi.totalRuns` "Total runs ({period})"; `kpi.totalCost` "Total cost ({period})"; `kpi.avgAcceptRate` "Avg accept rate ({period})"; `kpi.mostActive` "Most-active agent ({period})".
   - `kpi.decisionsAndRuns` "{decisions, plural, one {# decision} other {# decisions}} · {runs, plural, one {# run} other {# runs}}"; `kpi.unpriced` "{count, plural, one {# run} other {# runs}} without a cost left out".
   - `table.agent` "Agent"; `table.runs` "Runs"; `table.avgCost` "Avg cost"; `table.avgDuration` "Avg duration"; `table.acceptRate` "Accept rate"; `table.lastRun` "Last run"; `table.view` "View"; `table.viewAgent` "View {name}".
   - `table.decisions` "{count, plural, one {# decision} other {# decisions}}"; `table.smallSample` "small sample"; `table.noRuns` "No runs in this period"; `table.deletedAgent` "Deleted agent".
   - `format.count` "{value, number}"; `format.rate` "{value, number, percent}"; `format.seconds` "{value, number} s"; `none` "—".
   - `cost.title` "Cost breakdown"; `cost.byAgent` "By agent"; `cost.byModel` "By model"; `cost.unknownModel` "Unknown model"; `cost.none` "No cost recorded for this period".
   - `estimate.mark` "DevDigest estimate"; `estimate.note` "Computed by DevDigest from provider-reported or price-table costs — not billing data."
   - `states.loadError` "Could not load agent performance."; `states.emptyTitle` "No agent runs in {period}"; `states.emptyBody` "Run a review on a pull request to see agent performance here."
4. `hooks/agents.ts`: `useAgentPerformance(range: { from: string; to: string } | null)` → `useQuery({ queryKey: ["agent-performance", range?.from, range?.to], queryFn: () => api.get<AgentPerf>(`/agents/performance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), enabled: !!range })`. Use `import type { AgentPerf }`. No `placeholderData`: a new key must show placeholders, not old data (EC-20).
5. `constants.ts`: `PERIOD_KINDS = ["1d", "30d", "custom"] as const`, `DEFAULT_PERIOD = "30d"`, `DAY_MS = 86_400_000`, URL keys `period`, `start`, `end`.
6. `helpers.ts`, all pure:
   - `parsePeriod(search: URLSearchParams, today: string)`: `{kind:"1d"}`, `{kind:"30d"}`, or `{kind:"custom", start, end}` with `YYYY-MM-DD` local dates. Anything missing or invalid, including a custom range that fails validation, becomes `{kind:"30d"}` (AC-4, AC-45).
   - `validateCustom(start, end, today): "inverted" | "future" | null` (AC-6).
   - `periodRange(period, nowMs)`: 1d → `[now − DAY_MS, now)`; 30d → `[now − 30·DAY_MS, now)`; custom → `new Date(y, m−1, d)` of start to `new Date(y, m−1, d+1)` of end, as `toISOString()` (AC-5).
   - `periodSearch(period)`: `period=1d` | `period=30d` | `period=custom&start=…&end=…` (AC-44).
   - `localToday(nowMs)`: `YYYY-MM-DD`.
   - `sortByAcceptRate(rows, dir)`: rows with `!small_sample && accept_rate !== null` sorted by rate in `dir`, then every other row ordered by `accept_rate` (nulls last) and name, in both directions (AC-14).
   - `formatCost(usd)`: `Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d })` with `d` = 4 / 3 / 2 by the same thresholds as `formatUsd`, so `$1,234.56` and `$0.0013` (NFR-3).
Skills: `frontend-ui-architecture` → `devdigest.md` § The tier map and `placement.md` (helpers shared by two children of one route sit at the route segment; data in `lib/hooks/<area>.ts`); `react-best-practices` → `SKILL.md` § Data Fetching (hooks only, no `fetch` in components); `react-testing-library` → `SKILL.md` § Query Priority (role and name queries in the nav test).
Tests to add: `client/src/app/agent-performance/helpers.test.ts`. It covers `periodRange` with a fixed `nowMs` for all three kinds (AC-5); `validateCustom` for inverted and future (AC-6); `parsePeriod` with none, invalid and custom (AC-4, AC-45); `sortByAcceptRate`, where a small-sample 100% row sorts below a 60% row in both directions (AC-14); and `formatCost(1234.5)` → `"$1,234.50"` (NFR-3). The nav test change covers AC-1 and AC-2.
Done when: `.claude/agents/scripts/check-code.sh client -- helpers.test navigation.test` passes, and the `Test Files` count includes both files.

### Stage 6 — Cards, table, cost breakdown (client, presentational)
Track: client · After: 5
Files: `client/src/vendor/ui/charts/Donut.tsx`; `client/src/app/agent-performance/_components/TruncatedText/{TruncatedText.tsx,index.ts}`; `client/src/app/agent-performance/_components/AgentPerformanceView/_components/KpiCards/{KpiCards.tsx,index.ts,KpiCards.test.tsx}`, `…/AgentTable/{AgentTable.tsx,index.ts,styles.ts,AgentTable.test.tsx}`, `…/CostBreakdown/{CostBreakdown.tsx,index.ts,CostBreakdown.test.tsx}`
Read first: `client/src/vendor/ui/charts/Donut.tsx`, `client/src/vendor/ui/charts/MetricCard.tsx`, `client/src/vendor/ui/primitives/Badge.tsx:1-25`, `client/src/vendor/ui/primitives/Card.tsx`, `client/src/app/eval/_components/EvalDashboard/EvalDashboard.tsx:1-80`, `client/src/app/eval/_components/EvalDashboard/styles.ts`, `client/src/app/eval/_components/EvalDashboard/EvalDashboard.test.tsx:1-100`, `client/src/app/agent-performance/helpers.ts` (stage 5)
Steps:
1. `Donut.tsx`: add an optional `hideLegend?: boolean` (default false) that skips the legend block. Existing callers are unchanged.
2. `TruncatedText({ text, style? })`: a `<span>` with `title={text}`, `tabIndex={0}`, `overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`, `minWidth: 0`, `display: block`. On `onFocus` it switches to `whiteSpace: normal` + `overflowWrap: "anywhere"`, and on `onBlur` it switches back (AC-43 "on hover and focus"). It renders text only (NFR-5).
3. `KpiCards({ summary, periodLabel })`: four `Card`s in a grid `repeat(4, minmax(0, 1fr))`.
   - Labels come from `kpi.*` with `{ period: periodLabel }` (AC-8).
   - Total runs: `format.count`.
   - Total cost: `formatCost(total_cost_usd)` or `none`, plus a `Badge` `estimate.mark`, the `estimate.note` text, and `kpi.unpriced` when `unpriced_runs > 0` (AC-38, AC-39).
   - Avg accept rate: `format.rate` or `none`, plus `kpi.decisionsAndRuns` (AC-9).
   - Most-active: `TruncatedText` name, `format.count` runs, and rate or `none`. When `most_active_agent` is null it shows `none` (section 7) (AC-10).
4. `AgentTable({ rows, sortDir, onToggleSort, onView })`: a native `<table>` with `tableLayout: fixed`, `width: 100%`.
   - Headers in AC-11 order. Accept rate `<th aria-sort={sortDir === "desc" ? "descending" : "ascending"}>` holds a native `<button>` named "Accept rate" that toggles the direction (NFR-4). The Avg cost header carries the `estimate.mark` `Badge` (AC-38).
   - Rows come from `sortByAcceptRate(rows, sortDir)`.
   - Name cell: `TruncatedText` of `agent_name`, or `table.deletedAgent` when `agent_id` is null (AC-17).
   - When `runs === 0`: one `<td colSpan={5}>` with `table.noRuns` (AC-37).
   - Otherwise:
     - Runs: `format.count`.
     - Avg cost: `formatCost` or `none`.
     - Avg duration: `format.seconds` with `Math.round(ms / 100) / 10`, or `none`.
     - Accept rate: `format.rate` or `none`, then `table.decisions`, then a `Badge` `table.smallSample` when `small_sample` (AC-12, AC-13, EC-3).
     - Last run: `formatRunTime` from `@/components/eval-runs`, or `none`.
   - View: a native `<button>` with visible text `table.view` and accessible name `table.viewAgent`, `onClick={() => onView(agent_id)}`. It is omitted when `agent_id` is null (AC-16, AC-17, NFR-4).
   - The sort direction state lives in the parent (stage 7), default `"desc"` (AC-15).
5. `CostBreakdown({ byAgent, byModel, totalCostUsd })`:
   - A section heading `cost.title` + `Badge` `estimate.mark` + `estimate.note` (AC-38).
   - When `totalCostUsd === null`: only the text `cost.none` (AC-19).
   - Otherwise two blocks, `cost.byAgent` and `cost.byModel`. Each is a `Donut` with `hideLegend` and segments coloured from a fixed local palette, plus an own legend list where each item is the colour swatch + `TruncatedText` of the label (`table.deletedAgent` for a null agent label, `cost.unknownModel` for a null model label, AC-46) + `formatCost(value)` (AC-18, NFR-4).
   - The legend grid uses `minmax(0, 1fr)`.
Skills: `frontend-ui-architecture` → `placement.md` (a child goes under the single parent that renders it; `TruncatedText`, shared by two siblings, sits at the route segment's `_components/`) and `composition.md` (presentational props, parent owns state); `react-best-practices` → `SKILL.md` § Derive, Don't Store (sorted rows computed in render) and § Accessibility; `react-testing-library` → `SKILL.md` § List/Table Component, § Query Priority.
Tests to add:
- `KpiCards.test.tsx` covers AC-8 ("Total runs (30d)"), AC-9 (41 decisions, 253 runs), AC-10, AC-38 (mark + note on the card), AC-39 (`unpriced_runs` 3 → "3 runs without a cost left out"), and NFR-3 (1234 runs → "1,234").
- `AgentTable.test.tsx` covers:
  - AC-11 (header order, row count) and AC-12 (9/12 → "75%" and "12 decisions").
  - AC-13 and AC-14 (a small-sample 100% row below a 60% row, both directions, after clicking the sort button) and AC-15 (first row and `aria-sort="descending"`).
  - AC-16 (`onView` gets the id), AC-17 ("Deleted agent", no View), AC-37 (zero-run row shows "No runs in this period", no "0%", no "$0").
  - AC-43 (a 200-char name has the full `title`), NFR-5 (the name `<img src=x onerror=alert(1)>` renders as literal text and no `img` exists).
- `CostBreakdown.test.tsx` covers AC-18 (both legends list the segments with `$` amounts), AC-19 (null total → text, no legend), and AC-46 ("Unknown model").
- Every test wraps `NextIntlClientProvider` with `{ agentPerformance, common }`.
Done when: `.claude/agents/scripts/check-code.sh client -- KpiCards.test AgentTable.test CostBreakdown.test` passes with `Test Files 3`.

### Stage 7 — Screen container, period picker, page (client)
Track: client · After: 6
Files: `client/src/app/agent-performance/page.tsx`; `client/src/app/agent-performance/_components/AgentPerformanceView/{AgentPerformanceView.tsx,index.ts,styles.ts,AgentPerformanceView.test.tsx}`; `…/AgentPerformanceView/_components/PeriodPicker/{PeriodPicker.tsx,index.ts}`; `client/README.md`
Read first: `client/src/app/eval/page.tsx`, `client/src/app/agents/[id]/page.tsx:1-35` (`useSearchParams` + `router.replace`), `client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx:1-30` (mocking `useSearchParams`), `client/src/app/eval/_components/EvalDashboard/EvalDashboard.test.tsx:1-100` (fetch mock, QueryClient, intl wrapper), `client/src/vendor/ui/primitives/ErrorState.tsx`, `client/src/vendor/ui/primitives/EmptyState.tsx`, `client/src/vendor/ui/primitives/Skeleton.tsx`, `client/src/lib/providers.tsx`, `client/README.md:19-45`
Steps:
1. `page.tsx`: a server component rendering `<Suspense><AgentPerformanceView /></Suspense>`, because the view reads `useSearchParams`.
2. `PeriodPicker({ period, today, onSelect })`:
   - Three native `<button aria-pressed>` labelled `period.choices.*` (AC-3, NFR-4).
   - Custom reveals two labelled `<input type="date">` (`period.custom.start` / `end`, `max={today}`) and an Apply `<button>`.
   - Apply runs `validateCustom`. On failure it shows `period.custom.inverted` / `future` next to the inputs (`role="alert"`) and calls nothing (AC-6). On success it calls `onSelect({ kind: "custom", start, end })`.
   - 1 day / 30 days call `onSelect` directly.
3. `AgentPerformanceView`:
   - `"use client"`. Uses `useSearchParams` and `useRouter`.
   - State: `const [selection, setSelection] = useState(() => ({ period: parsePeriod(search, localToday(Date.now())), anchor: Date.now() }))`. The URL is mirrored, not read back, so a mocked router still drives the request.
   - `range = useMemo(() => periodRange(selection.period, selection.anchor), [selection])`.
   - `onSelect(p)`: `setSelection({ period: p, anchor: Date.now() })` + `router.replace(`/agent-performance?${periodSearch(p)}`)` (AC-5, AC-44).
   - `const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")`.
   - `const q = useAgentPerformance(range)`.
   - Render inside `AppShell` with `crumb={[{ label: t("title") }]}`: an `h1` `title`, then the `PeriodPicker`, then:
     - `q.isPending`: `Skeleton` placeholders for cards, table and breakdown, with no text node holding a digit (AC-34, EC-20).
     - `q.isError`: `ErrorState` with `title={t("states.loadError")}`, without `onRetry`, because its button text is hardcoded, plus a `Button` labelled `common` `actions.retry` that calls `q.refetch()` (AC-35).
     - `data.summary.runs === 0`: one `EmptyState` titled `states.emptyTitle` with the period label (AC-36).
     - Otherwise: `KpiCards`, `AgentTable` with `onView={(id) => router.push(`/agents/${id}`)}` (AC-16), and `CostBreakdown` with `data.summary.total_cost_usd`.
   - The period label is `period.short.*` (`{start} – {end}` for custom).
   - The page grid uses `minmax(0, 1fr)` (AC-43).
4. `client/README.md § UI route map`: add the node `AP["/agent-performance?period=<br/>Agent Performance (GLOBAL)"]` and the edge `AP -->|"GET /agents/performance?from=&to="| API`.
Skills: `next-best-practices` → `suspense-boundaries.md` (`useSearchParams` under a Suspense boundary); `frontend-ui-architecture` → `app-router.md` (thin `page.tsx`, client boundary in the feature component); `react-best-practices` → `SKILL.md` § Data Fetching (loading, error and empty handled in the container) and § Derive, Don't Store (range and label derived, not stored); `react-testing-library` → `SKILL.md` § Async Testing (`findBy`), § Mocking Strategies (module mock of `next/navigation`, `fetch` stub).
Tests to add: `AgentPerformanceView.test.tsx`. Use a fixed `Date.now` (`vi.useFakeTimers({ toFake: ["Date"] })` or `vi.setSystemTime`), mock `next/navigation` (`useRouter` with `push` / `replace` spies, and `useSearchParams` from a test-controlled `URLSearchParams`), stub `fetch`, and use `createQueryClient()` with `setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } })`. It covers:
- AC-3 (three choices) and AC-4 (no URL → first request carries a 30-day range; "30 days" `aria-pressed`).
- AC-5 (1 day then a custom range → one `fetch` per selection with the expected `from`/`to`, found across all `fetchMock.mock.calls`).
- AC-6 (inverted and future ranges → message, no extra `fetch`).
- AC-44 (`replace` receives `period=1d`, then `period=custom&start=…&end=…`) and AC-45 (custom range in the URL → selected, first request carries its range).
- AC-34 (pending `fetch` → no digit in the cards, table or breakdown regions) and AC-35 (500 → message + Retry, no digit; Retry → the same URL fetched again).
- AC-36 (`runs` 0 → empty-state text, no `table`) and AC-41 (every recorded call has method GET or none, across load, period change, sort and View).
Done when: `.claude/agents/scripts/check-code.sh client` passes unfiltered (the whole client suite, root `INSIGHTS.md` :54).

## 5. Skills matrix
| Stage | zod | onion-architecture | fastify-best-practices | drizzle-orm-patterns | security | frontend-ui-architecture | react-best-practices | next-best-practices | react-testing-library |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `references/object-optional-vs-nullable.md` | `rules/zod-contracts.md` | | | | | | | |
| 2 | | `rules/layers.md`, `rules/ports-and-di.md`, `rules/testing.md` | | | | | | | |
| 3 | `references/schema-string-validations.md`, `references/refine-add-path.md` | `rules/fastify-transport.md`, `rules/errors.md`, `rules/drizzle-persistence.md`, `rules/ports-and-di.md` | `rules/schemas.md`, `rules/routes.md`, `rules/testing.md` | `references/queries-joins-aggregations.md` | `SKILL.md` | | | | |
| 4 | | `rules/testing.md` | `rules/testing.md` | | | | | | |
| 5 | | | | | | `devdigest.md`, `placement.md` | `SKILL.md` § Data Fetching | | `SKILL.md` § Query Priority |
| 6 | | | | | | `placement.md`, `composition.md` | `SKILL.md` § Derive, Don't Store, § Accessibility | | `SKILL.md` § List/Table Component |
| 7 | | | | | | `app-router.md` | `SKILL.md` § Data Fetching | `suspense-boundaries.md` | `SKILL.md` § Async Testing, § Mocking Strategies |

## 6. Verification
| Package | Command (from the repository root) | Proves |
|---|---|---|
| shared | `diff -u server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts` (empty) and `diff -u server/src/vendor/shared/contracts/productionize.ts client/src/vendor/shared/contracts/productionize.ts` (only the `:36` hunk) | NFR-2: the copies did not drift |
| server | `.claude/agents/scripts/check-code.sh server` | typecheck, depcruise (layering rules in section 3), unit lane: helpers (AC-13, 24, 26, 27, 29) and route schema (AC-7) |
| server | `.claude/agents/scripts/check-code.sh --it server` (Docker) | the same, then `agent-performance.it.test.ts`: AC-20…AC-33, AC-40, AC-42, AC-46. Report that it executed, not skipped. |
| server | calling session: the `/tmp` tsconfig recipe of `server/INSIGHTS.md` :119/:128 over `server/test/agent-performance{-helpers,-routes,}.test.ts` and `.it.test.ts` | the new test files type-check (`pnpm typecheck` skips `test/**`) |
| reviewer-core | `.claude/agents/scripts/check-code.sh --no-tests reviewer-core` | the loosened server contract copy still compiles where reviewer-core reads it |
| client | `.claude/agents/scripts/check-code.sh client` | typecheck (tests included), the whole component suite: AC-1…AC-6, AC-8…AC-19, AC-34…AC-39, AC-41, AC-43…AC-46, NFR-3…NFR-5 |
| client | `pnpm build` in `client/` (in a copy per `client/INSIGHTS.md` :91 when the dev stack runs) | NFR-2: type-only import of `@devdigest/shared`; `/agent-performance` builds |
| both | `grep -rn "dangerouslySetInnerHTML\|innerHTML" client/src/app/agent-performance` and `grep -rnE "llm\(|complete(Structured)?\(|jobs\." server/src/modules/agent-performance` both print nothing (`grep -rn`, not `git grep`, since the files are untracked: root `INSIGHTS.md` :78) | NFR-5; AC-40 and NFR-1 statically |
| manual (user / calling session) | dev stack: restart the API after the contract edit (`server/INSIGHTS.md` :99); snapshot `select count(*) from agent_runs` / `run_traces`; open `/agent-performance`, switch periods, sort, open an agent; snapshot again; take an `agent-browser screenshot <abs path>` at the real pane width | NFR-1 (root `INSIGHTS.md` :46); AC-43 has no sideways scroll (`client/INSIGHTS.md` :85) |

`./scripts/e2e.sh` is not needed: no existing journey changes.

## 7. Risks and open questions
- [settled] Execution mode: multi-agent (section 9).
- [non-blocking] Copy the spec does not state is written by the plan in `agentPerformance.json` (stage 5 step 3): the two validation messages, the error text (taken from the pre-wired `loadError`), the empty-state body, the "—" placeholder, and the "View {name}" accessible name. To change the wording, edit that file only.
- [non-blocking] When every counted run belongs to deleted agents, `summary.most_active_agent` is null while `runs > 0`. The deleted-agents row is not an agent (AC-17, AC-26). The card then shows "—" in the name, run and rate slots (stage 6 step 3), never a made-up zero (G-3). REC4 asks for a criterion.
- [non-blocking] `fastify-type-provider-zod` with a `.refine`d object as `querystring`. The agents routes already use `.refine` on `body` (`server/src/modules/agents/routes.ts:60-68`), and validation errors map to 422 at `server/src/app.ts:132`. The stage 3 hermetic test proves the querystring case. If it fails, move the `from < to` check into the same schema through `superRefine`, never into the handler.
- [non-blocking] Float sums: `summary.total_cost_usd` (Σ rows) and Σ `cost_by_model` (SQL `sum`) can differ in the last bits. The tests compare with `toBeCloseTo`. Rounding is a display concern only.
- [non-blocking] `agent_runs` and `reviews.run_id` carry no index (no `index` on either in `server/src/db/migrations/*.sql`). The routes scan the workspace's runs on every load. See REC1.

## 8. Handoff to reviewers
- Architecture: the new module `agent-performance` reads four shared tables (`agents`, `agent_runs`, `reviews`, `findings`) from its own `repository.ts`, with no import of another module's repository (`no-cross-module-internals`). The consumer-declared port `AgentPerformanceStore` is in `types.ts`. The service takes `{ store }` only (`no-service-to-container`). `/agents/performance` and `/agents/:id/stats` live outside the agents plugin; check the static-versus-param route precedence. The pure aggregation lives in `helpers.ts` and is shared by both routes (AC-32). The vendored `Donut` gains an optional `hideLegend`.
- Security: two new GET routes (UI-1, UI-2). `from`/`to` go through `datetime({ offset: true })` + refine before the handler and are bound as Drizzle parameters. `:id` is a uuid, workspace-scoped, and gives 404 across tenants. No raw HTML: agent and model names are rendered as text through `TruncatedText` (NFR-5, UI-3). The only row link is `/agents/${agent_id}` through `router.push`. No writes, no provider calls (AC-40).

## 9. Execution
Mode: multi-agent (recommended option; the user delegated the choice, 2026-10-17).
Recommended: multi-agent. After stage 1 the server track (2–4) and the client track (5–7) share no file. Each track holds non-trivial work, and the client tests mock `fetch`, so neither waits for the other.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| shared | 1 | `server/src/vendor/shared/contracts/{productionize,observability}.ts`, `client/src/vendor/shared/contracts/{productionize,observability}.ts` | — | alone |
| server | 2–4 | `server/src/modules/agent-performance/**`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/test/agent-performance*.ts`, `server/README.md` | shared | parallel |
| client | 5–7 | `client/src/vendor/ui/nav.ts`, `client/src/vendor/ui/charts/Donut.tsx`, `client/src/components/app-shell/navigation.test.tsx`, `client/messages/en/agentPerformance.json`, `client/src/lib/hooks/agents.ts`, `client/src/app/agent-performance/**`, `client/README.md` | shared | parallel |
| join | — (verification only) | none | server, client | alone: the calling session runs section 6 unfiltered |

Briefs: one or two stages each, a fresh `implementer` per brief, in order inside a track.
- shared · stage 1 → "Execute stage 1 of specs/2026-10-17-agent-performance-dashboard-plan.md (track shared). Write only inside: server/src/vendor/shared/contracts/{productionize,observability}.ts, client/src/vendor/shared/contracts/{productionize,observability}.ts. Check with: .claude/agents/scripts/check-code.sh --no-tests server client reviewer-core."
- server · stages 2–3 → "Execute stages 2–3 of specs/2026-10-17-agent-performance-dashboard-plan.md (track server). Write only inside: server/src/modules/agent-performance/**, server/src/modules/index.ts, server/src/platform/container.ts, server/test/agent-performance-helpers.test.ts, server/test/agent-performance-routes.test.ts. Check with: .claude/agents/scripts/check-code.sh server."
- server · stage 4 → "Execute stage 4 of specs/2026-10-17-agent-performance-dashboard-plan.md (track server). Write only inside: server/test/agent-performance.it.test.ts, server/README.md. Check with: .claude/agents/scripts/check-code.sh --it server -- agent-performance."
- client · stage 5 → "Execute stage 5 of specs/2026-10-17-agent-performance-dashboard-plan.md (track client). Write only inside: client/src/vendor/ui/nav.ts, client/src/components/app-shell/navigation.test.tsx, client/messages/en/agentPerformance.json, client/src/lib/hooks/agents.ts, client/src/app/agent-performance/{constants,helpers,helpers.test}.ts. Check with: .claude/agents/scripts/check-code.sh client -- helpers.test navigation.test."
- client · stage 6 → "Execute stage 6 of specs/2026-10-17-agent-performance-dashboard-plan.md (track client). Write only inside: client/src/vendor/ui/charts/Donut.tsx, client/src/app/agent-performance/_components/TruncatedText/**, client/src/app/agent-performance/_components/AgentPerformanceView/_components/{KpiCards,AgentTable,CostBreakdown}/**. Check with: .claude/agents/scripts/check-code.sh client -- KpiCards.test AgentTable.test CostBreakdown.test."
- client · stage 7 → "Execute stage 7 of specs/2026-10-17-agent-performance-dashboard-plan.md (track client). Write only inside: client/src/app/agent-performance/page.tsx, client/src/app/agent-performance/_components/AgentPerformanceView/{AgentPerformanceView.tsx,index.ts,styles.ts,AgentPerformanceView.test.tsx}, client/src/app/agent-performance/_components/AgentPerformanceView/_components/PeriodPicker/**, client/README.md. Check with: .claude/agents/scripts/check-code.sh client."

single-agent: the same briefs run one after another (1 → 2–3 → 4 → 5 → 6 → 7), and the Runs column is not used.

## 10. Recommendations — not applied
- REC1 [approach] Add indexes `agent_runs (workspace_id, ran_at)` and `reviews (run_id)`.
  - Why: no migration declares an index on either. Every dashboard load and every stats call scans the workspace's runs and joins reviews by `run_id`.
  - Would change: a new schema stage before stage 3 (`server/src/db/schema/{runs,reviews}.ts` + `pnpm db:generate` → `0020_*.sql`), with the drizzle and postgresql lanes. Applying it to the dev DB stays the user's step.
- REC2 [scope] Delete the contract fields no criterion needs instead of making them `.optional()`. These are `AgentPerfRow.provider/model/findings_total/dismiss_rate/avg_findings_per_run/findings_by_severity/trend` and the `AgentStats` counterparts.
  - Why: no file reads them (`grep -rn "AgentPerf\|AgentStats" server/src client/src mcp/src` shows contracts only). NG-1 and NG-3 rule out the sparkline and the Stats tab that would.
  - Would change: stage 1 only, and a smaller wire shape.
- REC3 [requirements] Key AC-19's text on "no segment to draw" rather than on `total_cost_usd` null.
  - Why: a run priced at exactly $0 (a free model) gives a non-null total of 0, while `PerfCostSegment.value` is `> 0` (`:199`). Both charts would then render empty instead of showing the text.
  - Would change: the condition in stage 6 step 5 and one `CostBreakdown` test; `spec-creator` would revise AC-19.
- REC4 [requirements] Add a criterion for the Most-active card when every counted run belongs to deleted agents.
  - Why: AC-26 leaves `most_active_agent` null there although `runs > 0`, and AC-10 assumes an agent exists. The plan shows "—" (section 7).
  - Would change: stage 6 step 3 and one `KpiCards` test; a spec revision by `spec-creator`.
