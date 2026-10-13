# Implementation Plan — Eval trend charts (SPEC-05)
Source: `client/specs/2026-10-12-eval-trend-charts.md` (Status: approved; `check-spec.sh` ok, one WARN on the manual ring of AC-24) · Base: `1d4e77f` · Packages: client

Starts only after stages 9–13 of `specs/2026-10-12-eval-pipeline-plan.md` (the SPEC-03 plan) are done and green. Nothing of the SPEC-03 client part is in the tree at `1d4e77f`, so every path marked "SPEC-03 stage N" is read from that plan, not from code, and is verified at implementation time.

## 0. Before the first edit

- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "`@testing-library/user-event` is not a `client/` dependency" → every interaction is `fireEvent` (`mouseEnter`, `mouseLeave`, `keyDown`, `blur`); AC-13 is proven by role, name and `.focus()`.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "`client/` typecheck DOES cover `*.test.tsx`" → fixtures are typed `EvalRun`; indexed reads in tests carry `!`.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "A vitest name-fragment filter also matches DIRECTORY names" and "A vitest path filter under a Next.js dynamic segment silently matches nothing" → filters below are file-name fragments (`MetricTrend.test`, `EvalsTab.test`); each Done-when names the expected `Test Files N`.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "A bare ICU argument does not group digits" → the run count is a plural argument (`#`), at most 20.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors & Fixes` — "`@devdigest/shared` is a TYPE-only dependency" → `import type { EvalRun }` only; the metric list is a local literal tuple.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors & Fixes` — "`Unable to find an element with the text: $0.0013`" → each tooltip line is one element holding one string; cost is asserted on the joined text.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors & Fixes` — "A vitest hook that RETURNS a function" → mock-resetting hooks get a block body.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors & Fixes` — "React counts `borderColor` and `borderWidth` as SHORTHANDS too" → no shorthand/longhand mix in tooltip or marker styles that change on rerender.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors & Fixes` — "The PR page renders blank … after `pnpm build`" → the build check runs on a copy, by the calling session (stage 4).
- INSIGHTS: `client/INSIGHTS.md § What Doesn't Work` — "An absolutely-positioned hover card … gets clipped" → the chart card sets no `overflow: hidden`; the tooltip stays inside the plot box.
- INSIGHTS: `client/INSIGHTS.md § Open Questions` — "whether a shared `src/components/*` component forces … the `common` namespace" → `MetricTrend` uses the pure `formatUsd`, not `RunCostBadge`, so its tests register `eval` only.
- INSIGHTS: `INSIGHTS.md § Codebase Patterns` — "The starter pre-wires a course lesson" → `dashboard.metricTrend`, `dashboard.legend.*`, `dashboard.loading`, `dashboard.table.cost` already exist (`client/messages/en/eval.json:4,9,18-20,28`); `Sparkline` exists in `client/src/vendor/ui/charts/`.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "A plan's absence check on generic words" and "Proving absence with `git grep`" → absence checks use `grep -rn`, scoped to this feature's folder.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "An implementer's token bill is turns × standing context" → three briefs of one stage each.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "A spec's `IN-n` pointer to `i/img_N.png` does not survive" → design evidence here is the JSX prototype only.
- Read: `client/specs/2026-10-12-eval-trend-charts.md`; `specs/2026-10-12-eval-pipeline-plan.md` §3 "Seams kept for SPEC-04 and SPEC-05" (`:245-249`) and stages 9, 11, 12, 13 (`:592-650`, `:677-773`); `client/AGENTS.md`; `docs/design/Dev Digest 2/Dev Digest/charts.jsx:12-29` and `screen_skills.jsx:440-452`.

### Library decision — hand-drawn SVG, settled from source, no probe stage

I read `recharts` 2.15.4 in `client/node_modules/recharts/es6`; I did not run it. The findings:

1. **Nothing renders under jsdom with the container-width setup AC-24 needs.**
   - `component/ResponsiveContainer.js:94-97` takes its size from `getBoundingClientRect()` on mount, afterwards only from the `ResizeObserver` callback (`:79-93`).
   - jsdom returns 0×0, and the stub in `client/src/test/setup.ts:3-9` never calls back.
   - The chart is cloned with width 0 (`:111-134`), and `chart/generateCategoricalChart.js:1901` returns `null` when `validateWidthHeight` fails (`util/ReactUtils.js:134-142`).
   - Tests could only pass with a fixed numeric width that production does not use.
2. **The keyboard path cannot meet AC-14 and AC-15.**
   - `accessibilityLayer` handles `ArrowLeft` and `ArrowRight` only (`chart/AccessibilityManager.js:52-70`).
   - The wrapper gets `onKeyDown` and `onFocus` and nothing for Escape or blur; the source says neither handler can be passed through (`generateCategoricalChart.js:1930-1946`).
   - `onFocus` activates index 0 at once (`AccessibilityManager.js:39-42`), which contradicts AC-14's check "focus, Right, Right shows the tooltip of the second plotted run".
3. **The active index comes from a synthetic mouse position** computed from `getBoundingClientRect()` (`AccessibilityManager.js:95-107`, `generateCategoricalChart.js:1683-1690`), a zero rect in jsdom.
4. **The live region exists only in the default tooltip content** (`component/DefaultTooltipContent.js:118-119`, `aria-live: 'assertive'`); the custom content AC-10, AC-11 and AC-27 need loses it.
5. **The vendored `LineChart` is used only by the showcase** (`client/src/components/showcase/Showcase.tsx:202-205`).

Point 2 does not depend on jsdom, so a probe test could not change the outcome. The spec's rule (`client/specs/2026-10-12-eval-trend-charts.md:66-70`) takes hand-drawn SVG when the library "offers no keyboard path". Question 2 offers the probe anyway.

Consequences: no file under `client/src/vendor/ui/charts/` changes (one conditional exception in stage 3 step 2). `recharts` is not imported by this feature. No dependency is added (NFR-4).

## 1. Scope — as the source states it

Pointers are lines of `client/specs/2026-10-12-eval-trend-charts.md`.

Goal:
- G-1 "An agent author sees how recall, precision and citation accuracy of one agent moved across that agent's eval runs, as a chart with one point per run." — `:32`
- G-2 "An agent author reads from a run's point which prompt version that run used and what it cost." — `:33`
- G-3 "The values behind the chart are reachable from the keyboard and by a screen reader." — `:34`
- G-4 "Looking at the trend starts no model call and adds no request to the ones SPEC-03's screens already send." — `:35`

Non-goals:
- NG-1 "Thresholds, a threshold line on the chart, alerts and any gating on a metric" — `:37`
- NG-2 "A new API route, a new query parameter, a contract change, and any use of the reserved `EvalTrendPoint` and `EvalDashboard.trend` declarations" — `:38`
- NG-3 "A sparkline on each agent row of the Eval Dashboard list" — `:39`
- NG-4 "The "30 days" range control" — `:40`
- NG-5 "Changing what SPEC-03 defines: the metric formulas, the run list and its cap, the tiles' values and differences, the precision banner, the run history table and the compare view" — `:41`
- NG-6 "A trend across several agents on one chart, and a trend for a skill's cases" — `:42`
- NG-7 "A browser e2e flow" — `:43`

Acceptance criteria:
- AC-1 "The Evals tab shall show the trend chart of the agent after the metric tiles." — `:74` — clear
- AC-2 "The agent's eval view shall show the trend chart of the agent between the metric tiles and the run history table." — `:75` — clear
- AC-3 "The trend chart shall show the heading "Metric trend" and a legend that names its three series "Recall", "Precision" and "Citation" in text." — `:76` — strings already there, `client/messages/en/eval.json:9,18-20`
- AC-4 "…one marker at the run position of every plotted run whose value of that metric is not null, with the run positions evenly spaced and ordered oldest first from left to right." — `:80` — clear
- AC-5 "The trend chart shall connect the markers of one metric at neighbouring run positions with a line." — `:81` — clear
- AC-6 "The trend chart shall plot only the runs of the run list that are in status `done`." — `:82` — clear
- AC-7 "The trend chart shall scale its vertical axis from 0.6 to 1.0 with a labelled gridline at each tenth." — `:83` — clear
- AC-8 "IF a plotted value is lower than 0.6, THEN the trend chart shall lower the bottom of its vertical axis to the highest tenth that is not above the lowest plotted value." — `:84` — clear
- AC-9 "IF a metric of a plotted run is null, THEN the trend chart shall draw for that metric no marker at that run position and no line to or from it." — `:85` — clear
- AC-26 "The trend chart shall label each run position on the horizontal axis with that run's agent version as `vN`." — `:86` — clear
- AC-20 "WHEN a run of the run list changes from `running` to `done`, the trend chart shall show that run's markers without a page reload." — `:87` — clear
- AC-21 "The trend chart shall show a caption "Last N runs", where N is the number of plotted runs." — `:88` — clear
- AC-10 "WHEN the pointer is over a run position, the trend chart shall show a tooltip that holds that run's agent version as `vN` and its cost." — `:92` — clear
- AC-11 "…besides the version and the cost, the run's start time and its recall, precision and citation accuracy as whole percentages, each named in text." — `:93` — clear
- AC-27 "…the run's cases passed of cases covered as "P/T cases", from the run's `cases_passed` and `cases_total`." — `:94` — clear
- AC-12 "IF the cost or a metric of the active run is null, THEN the trend chart shall show "—" in the tooltip in place of that value." — `:95` — clear
- AC-13 "The trend chart shall expose its plot as one keyboard tab stop whose accessible name holds "Metric trend" and the number of plotted runs." — `:99` — clear
- AC-14 "WHILE the plot has keyboard focus, WHEN the Left or the Right arrow key is pressed, the trend chart shall make the previous or the next plotted run the active run and show its tooltip." — `:100` — clear (see §7 for the first key press)
- AC-15 "WHEN the Escape key is pressed or keyboard focus leaves the plot, the trend chart shall hide the tooltip." — `:101` — clear
- AC-16 "WHEN the active run changes, the trend chart shall expose the tooltip's text through a live region." — `:102` — clear
- AC-17 "WHILE the run list holds no plotted run, the trend chart shall show its heading and a text that the trend appears after the agent's first completed run, with no axis and no marker." — `:106` — clear
- AC-18 "WHILE the run list is loading, the trend chart shall show the loading text of the `eval` namespace in place of the plot." — `:107` — string already there, `client/messages/en/eval.json:4`
- AC-19 "IF the read of the run list fails, THEN the trend chart shall show the failure state with the retry control that SPEC-03 AC-27 defines, in place of the plot." — `:108` — clear
- AC-22 "The agent's eval view shall show in each of its recall, precision and citation accuracy tiles a sparkline of that metric's non-null values over the plotted runs, oldest first." — `:112` — clear
- AC-23 "IF a metric has fewer than two non-null values over the plotted runs, THEN the agent's eval view shall show that metric's tile without a sparkline." — `:113` — clear
- AC-24 "The trend chart shall take the width of its container on the Evals tab and on the agent's eval view, without a horizontal scrollbar." — `:114` — clear, manual ring
- AC-25 "The trend chart shall render from the run list its surface already reads and send no request of its own." — `:118` — clear
- NFR-1 "…the client sends no `POST` and no request to a run-starting route while they render and while a run becomes active." — `:139` — clear
- NFR-2 "A surface that shows the trend chart and the run history table reads the run list once for both." — `:140` — clear
- NFR-3 "The feature changes nothing under `server/`, `mcp/`, `reviewer-core/` and neither `@devdigest/shared` copy" — `:141` — clear, manual ring
- NFR-4 "The feature adds no dependency to `client/package.json`." — `:142` — clear, manual ring
- NFR-5 "Every string of the feature comes from `client/messages/en/eval.json`, reusing `dashboard.metricTrend` and `dashboard.legend.*`; the run count in the caption and in the accessible name uses ICU plural forms; the start time, the percentages and the cost are formatted as the run history table of SPEC-03 AC-66 formats them." — `:143` — clear
- NFR-6 "Each series is named in text in the legend and in the tooltip…; the plot shows a visible focus indicator; the tile sparklines are hidden from assistive technology" — `:144` — clear; the focus ring is already there, `client/src/vendor/ui/styles.css:214-218`

Edge cases EC-1…EC-14 (`:122-135`) are each covered by the criteria the spec names beside them. No finding of kind `unclear`, `untestable`, `conflict` or `silent` changes the plan.

## 2. Impact map

| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| client | `client/messages/en/eval.json` | Modify — one new top-level `trend` block, nothing else | copy | AC-13, 17, 19, 21, 27, NFR-5 |
| client | `client/src/components/eval-runs/constants.ts` | New (verify: SPEC-03 stage 11 lists no `constants.ts`; if one exists, append) | shared by `MetricTrend` and `MetricTiles` | AC-3, 22 |
| client | `client/src/components/eval-runs/helpers.ts`, `helpers.test.ts` | Modify — exists after SPEC-03 stage 11; two functions appended | pure, common parent of the two siblings | AC-4, 6, 22, 23 |
| client | `client/src/components/eval-runs/MetricTrend/helpers.ts`, `helpers.test.ts` | New | pure geometry | AC-4, 5, 7, 8, 9, 14 |
| client | `client/src/components/eval-runs/MetricTrend/{MetricTrend.tsx,MetricTrend.test.tsx,styles.ts,index.ts}` | New | cross-route tier, rendered by `/agents/[id]` and `/eval/[agentId]` | AC-3…21, 26, 27, NFR-5, NFR-6 |
| client | `client/src/components/eval-runs/index.ts` | Modify — exists after SPEC-03 stage 11; two export lines | barrel | — |
| client | `client/src/components/eval-runs/MetricTiles/MetricTiles.tsx`, `MetricTiles.test.tsx` | Modify — exists after SPEC-03 stage 11; one optional prop | shared component | AC-22, 23, NFR-6 |
| client | `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx`, `EvalsTab.test.tsx` | Modify — exists after SPEC-03 stage 12; one JSX element, one import | route-local | AC-1, 19, 20, 25, NFR-1, NFR-2 |
| client | `client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx`, `AgentEvalView.test.tsx` | Modify — exists after SPEC-03 stage 13; one JSX element, one prop, one import | route-local | AC-2, 22, 25, NFR-2 |

Not touched: `client/src/vendor/ui/charts/**` (one conditional exception, stage 3 step 2), `client/src/vendor/shared/**`, `client/src/lib/hooks/evals.ts`, `client/package.json`, `client/pnpm-lock.yaml`, `server/**`, `mcp/**`, `reviewer-core/**`, `e2e/**`, `evals/**`, `.claude/**`.

Files this plan shares with the SPEC-04 plan (Case Editor, `specs/2026-10-12-case-editor.md`): `client/messages/en/eval.json`, `client/src/components/eval-runs/index.ts`, `EvalsTab.tsx`, `EvalsTab.test.tsx`, and possibly `AgentEvalView.tsx` and `eval-runs/helpers.ts`. A brief of this plan and a brief of SPEC-04 that write the same file never run at the same time (§9).

## 3. Constraints in play

- No dependency-cruiser config exists for `client/`; boundaries are held by `frontend-ui-architecture` and review.
- No contract change, no hook change, no new request: the chart is driven by props from the `useEvalRuns` result its surface already holds (NG-2, AC-25, NFR-2).
- `import type` only from `@devdigest/shared`. `EvalRun` is the run record of `client/src/vendor/shared/contracts/eval.ts` (SPEC-03 stage 1) — verify the exported name.
- Every string comes from `client/messages/en/eval.json`. Existing keys reused: `dashboard.metricTrend`, `dashboard.legend.{recall,precision,citation}`, `dashboard.loading`, `dashboard.table.cost`. SPEC-03 stage 9 keys reused: `runs.percent`, `runs.noValue`, `runs.history.versionValue`.
- The start time is formatted with the same call and options `RunHistory` uses (NFR-5). If those options sit inline in `RunHistory.tsx`, the implementer hoists them unchanged into `eval-runs/helpers.ts` or `constants.ts` and imports them in both — a move, not a new format.
- Component folder: `MetricTrend/MetricTrend.tsx` + one-line `index.ts`; tests beside the code; `fireEvent` only.
- Siblings do not import each other (`placement.md § Sub-component ownership`): what `MetricTrend` and `MetricTiles` both need lives in `eval-runs/constants.ts` and `eval-runs/helpers.ts`.
- `next build` is a calling-session step on a copy (recipe: SPEC-03 plan stage 15 step 3, `specs/2026-10-12-eval-pipeline-plan.md:795-797`).

## 4. Stages

### Stage 1 — Copy, shared constants and pure helpers
Track: client · After: SPEC-03 stages 9 and 11 green
Files: `client/messages/en/eval.json`, `client/src/components/eval-runs/constants.ts` (New), `client/src/components/eval-runs/helpers.ts`, `client/src/components/eval-runs/helpers.test.ts`, `client/src/components/eval-runs/MetricTrend/helpers.ts` (New), `client/src/components/eval-runs/MetricTrend/helpers.test.ts` (New)
Read first:
- `client/messages/en/eval.json` — reserved keys and the keys SPEC-03 stage 9 added.
- `client/src/components/eval-runs/helpers.ts` and `helpers.test.ts` — `toPercent`, `completedRuns` and the fixture style (SPEC-03 stage 11).
- `client/src/vendor/shared/contracts/eval.ts` — the run record's exported type name and its nullable fields.
- `docs/design/Dev Digest 2/Dev Digest/charts.jsx:12-29` — the prototype's padding and scale.
- `docs/design/Dev Digest 2/Dev Digest/screen_skills.jsx:440-452` — series colours.

Steps:
1. `eval.json`: add one top-level `trend` object after `page`. Change no existing key and reorder nothing.
   - `trend.caption` — `"{count, plural, one {Last # run} other {Last # runs}}"` (AC-21)
   - `trend.plotLabel` — `"{title}, {count, plural, one {# run} other {# runs}}"`; `title` is passed `dashboard.metricTrend` (AC-13)
   - `trend.cases` — `"{passed}/{total} cases"` (AC-27)
   - `trend.metricValue` — `"{name} {value}"` (AC-11, AC-12)
   - `trend.empty` — the implementer's wording for "the trend appears after the agent's first completed run" (AC-17)
   - `trend.loadError` — the implementer's wording: the run list could not be loaded (AC-19)
   - Retry label: reuse `evalsTab.retry` when SPEC-03 stage 9 wrote it as a plain label without arguments; otherwise add `trend.retry`.
2. `eval-runs/constants.ts`:
   - `TREND_METRICS`, a literal tuple of `{ key: "recall" | "precision" | "citation_accuracy", labelKey: "dashboard.legend.recall" | "dashboard.legend.precision" | "dashboard.legend.citation", color: "var(--accent)" | "var(--ok)" | "var(--warn)" }` in that order (`screen_skills.jsx:442-444,450`)
   - `export type TrendMetric = (typeof TREND_METRICS)[number]["key"]`
3. `eval-runs/helpers.ts`, appended:
   - `plottedRuns(runs: EvalRun[]): EvalRun[]` — the `done` runs, sorted by `Date.parse(started_at)` ascending, on a copy. Reuse `completedRuns` for the filter when it filters by `status === "done"`.
   - `metricSparklines(runs: EvalRun[]): Record<TrendMetric, number[] | null>` — per metric the non-null values of `plottedRuns(runs)`, oldest first; `null` when fewer than two (AC-23).
4. `MetricTrend/helpers.ts`, pure, no React. Positions are fractions, so no function knows a pixel size.
   - `TREND_AXIS_DEFAULT_MIN = 0.6`
   - `axisBounds(values: number[]): { min: number; max: number; ticks: number[] }`
     - `max` is 1. `min` is 0.6, or the tenth at or below the lowest value when that is under 0.6, never below 0.
     - Work in integer tenths: `Math.floor(Math.round(lowest * 1000) / 100)`, ticks as `tenth / 10`. This keeps 0.3 and 0.7 from drifting.
     - An empty array gives the default bounds.
   - `xFraction(index: number, count: number): number` — `0.5` for `count === 1`, else `index / (count - 1)`
   - `yFraction(value: number, bounds: { min: number; max: number }): number` — 0 at the bottom, 1 at the top
   - `lineSegments(values: (number | null)[]): number[][]` — each run of two or more neighbouring non-null indices, as index lists (AC-5, AC-9)
   - `stepActive(active: number | null, key: "ArrowLeft" | "ArrowRight", count: number): number | null`
     - `count === 0` → `null`
     - from `null`: Right → `0`, Left → `count - 1`
     - otherwise ±1, clamped to `0…count - 1`, no wrap

Skills: `frontend-ui-architecture` → `placement.md § Sub-component ownership` — "Anything two branches need moves up to their common parent"; `logic.md § The placement ladder` — "A rule that does not need React at all — a plain function". `react-testing-library` → `SKILL.md § What to Test / What to Skip` (routing matches every client test file; these are plain unit tests).
Tests to add:
- `MetricTrend/helpers.test.ts`:
  - `axisBounds`: values at or above 0.6 give ticks 0.6…1.0 (AC-7); 0.45 gives min 0.4 and seven ticks (AC-8); 0.6 exactly stays 0.6; 0.3 gives 0.3; empty gives the default.
  - `xFraction`: one run → 0.5; three runs → 0, 0.5, 1 (AC-4).
  - `lineSegments`: three values → one segment; null in the middle of three → none (AC-9); `[a, b, null, d, e]` → two; one value → none (AC-5).
  - `stepActive`: null+Right → 0; 0+Right → 1; last+Right → last; 1+Left → 0; count 0 → null (AC-14).
- `eval-runs/helpers.test.ts`, added cases:
  - `plottedRuns` on a newest-first list of two `done`, one `failed`, one `running` returns the two `done`, oldest first (AC-6, AC-4).
  - `metricSparklines`: three runs give three arrays oldest first; one run gives three nulls; a metric with one non-null value of three gives null (AC-22, AC-23).

Done when: `.claude/agents/scripts/check-code.sh client -- src/components/eval-runs/MetricTrend/helpers.test src/components/eval-runs/helpers.test` is green with `Test Files 2`; `node -e "JSON.parse(require('fs').readFileSync('client/messages/en/eval.json','utf8'))"` exits 0; `git diff client/messages/en/eval.json` shows added lines only (plus the comma after the `page` block).

### Stage 2 — `MetricTrend`: plot, tooltip, keyboard path, states
Track: client · After: 1
Files: `client/src/components/eval-runs/MetricTrend/{MetricTrend.tsx,MetricTrend.test.tsx,styles.ts,index.ts}` (New), `client/src/components/eval-runs/index.ts`
Read first:
- `client/src/components/eval-runs/MetricTrend/helpers.ts`, `client/src/components/eval-runs/constants.ts`, `client/src/components/eval-runs/helpers.ts` — stage 1.
- `client/src/components/eval-runs/RunHistory/RunHistory.tsx` and `RunHistory.test.tsx` — how the start time, `vN`, percentages and cost are formatted, and the test harness (provider, locale, time zone, fixtures).
- `client/src/components/eval-runs/index.ts` — the barrel's shape.
- `client/src/components/run-cost/helpers.ts:1-16` — `formatUsd`, `NO_COST`.
- `client/src/components/findings-summary/FindingsPopover.tsx:1-40` — the popover styling vocabulary.
- `client/src/test/setup.ts` — the `ResizeObserver` stub.
- `docs/design/Dev Digest 2/Dev Digest/charts.jsx:12-29` and `screen_skills.jsx:446-452` — the frame.

Steps:
1. `MetricTrend.tsx`, `"use client"`. Props: `{ runs: EvalRun[] | undefined; loading: boolean; failed: boolean; onRetry: () => void }`. The component calls no data hook and no `fetch` (AC-25).
2. Always rendered: an `h3` with `dashboard.metricTrend` and the legend. The legend is three items, each a colour swatch (`aria-hidden`) plus the text of `dashboard.legend.*`, from `TREND_METRICS` (AC-3, NFR-6).
3. The body is one of four, in this precedence:
   - `failed` → `trend.loadError` and a native `<button>` with the retry label that calls `onRetry`; no plot (AC-19).
   - `loading` → `dashboard.loading`; no plot (AC-18).
   - no plotted run → `trend.empty`; no plot (AC-17).
   - otherwise the plot and the `trend.caption` (AC-21).
4. Derived during render, nothing stored: `plotted = plottedRuns(runs ?? [])`; `bounds = axisBounds(every non-null metric value of plotted)`; per metric `values` and `lineSegments(values)`.
5. The plot wrapper is a `<div>` with `ref`, `role="group"`, `tabIndex={0}`, `aria-label` from `trend.plotLabel`, and `position: relative; width: 100%; minWidth: 0` (AC-13).
   - It sets no `outline` style: the focus ring is the global rule at `client/src/vendor/ui/styles.css:214-218` (NFR-6).
6. Width: `const [width, setWidth] = useState(TREND_DEFAULT_WIDTH)` with the default 620 (`charts.jsx:12`).
   - One `useEffect` creates a `ResizeObserver` on the wrapper, sets the width from `entries[0]?.contentRect.width` when it is above 0, and disconnects on cleanup.
   - Under the test stub the callback never fires and the default stands.
   - The `<svg>` gets `width={width}`, `height={200}`, `display: block`, `maxWidth: "100%"`, `aria-hidden="true"`. Padding is `{ l: 36, r: 14, t: 14, b: 24 }` (`charts.jsx:13`).
7. Inside the `<svg>`, with pixel positions computed from `xFraction` / `yFraction`:
   - per tick: a gridline and a `<text>` with `tick.toFixed(1)` (AC-7, AC-8)
   - per run position: a `<text>` with `runs.history.versionValue` under the plot (AC-26)
   - per metric and segment: one `<path data-series={key}>` (AC-5, AC-9)
   - per metric and non-null value: one `<circle data-series={key} data-run-index={i} r={3}>` (AC-4)
   - when a run is active: a vertical guide line at its position
   - per run position: a transparent `<rect data-run-band={i}>` from midpoint to midpoint over the plot height, with `onMouseEnter={() => setActive(i)}`
   - React keys are the run id and the metric key, never an array index alone.
8. Active run: `const [activeIndex, setActiveIndex] = useState<number | null>(null)`. The value used is `activeIndex` when it is below `plotted.length`, else `null`.
   - `onMouseLeave` on the wrapper → `null` (AC-10)
   - `onKeyDown`: `ArrowLeft` / `ArrowRight` → `stepActive(...)` with `preventDefault`; `Escape` → `null` (AC-14, AC-15)
   - `onBlur` → `null` (AC-15)
   - No effect is involved: all of this is event-handler logic.
9. Tooltip and live region are one element.
   - A `<div role="status" aria-live="polite">` is always mounted inside the wrapper and absolutely positioned at the top of the plot.
   - It is anchored by `left: <percent>` for a run in the left half and by `right: <percent>` for a run in the right half, so it never leaves the plot box. No `getBoundingClientRect`.
   - Its content exists only while a run is active (AC-16; hidden = empty, AC-15).
   - Content, each line one element with one string:
     - `runs.history.versionValue` (AC-10)
     - the start time, formatted as `RunHistory` formats it (AC-11)
     - three lines of `trend.metricValue` — `name` from `dashboard.legend.*`, `value` from `runs.percent` with `toPercent`, or `runs.noValue` for null (AC-11, AC-12), each with a swatch
     - `trend.cases` from `cases_passed` and `cases_total` (AC-27)
     - `trend.metricValue` with `name` = `dashboard.table.cost` and `value` = `formatUsd(cost_usd)` — null gives "—" (AC-10, AC-12)
10. `styles.ts`: the card, legend, tooltip and caption style objects. No `overflow: hidden` on the card. Per-side longhands wherever a border value changes between renders.
11. `MetricTrend/index.ts`: `export { MetricTrend } from "./MetricTrend";`. `eval-runs/index.ts`: add `export { MetricTrend } from "./MetricTrend";` and `export { metricSparklines } from "./helpers";` — two lines, in the existing style of that file.

Skills:
- `frontend-ui-architecture` → `placement.md § Components` — "Rendered by 2+ routes, knows the domain → `components/<name>/`"; `§ The component folder`; `boundaries.md § Barrels` — pure re-exports, never import through your own barrel from inside the module; `logic.md § The placement ladder` — the one Effect synchronizes with an external system (the element's size).
- `react-best-practices` → `SKILL.md § Derive, Don't Store`, `§ Hooks` (useEffect rules: cleanup, no derived state), `§ Key Prop Patterns`, `§ Accessibility` (`aria-live="polite"`).
- `react-testing-library` → `SKILL.md § Query Priority` — role and text first; SVG markers and bands have no accessible query, so they are read through `container.querySelectorAll` on the `data-*` attributes above (Tier 3, stated here on purpose).

Tests to add: `MetricTrend.test.tsx`, rendered with the real `eval.json`, `fireEvent` only, props-driven (no fetch mock needed):
- Heading and the three legend texts (AC-3).
- Three `done` runs given newest first: three circles per series; the first recall circle has `data-run-index="0"` and sits at the oldest run's x; one path per series (AC-4, AC-5).
- One run: three circles, no path (AC-5, EC-2).
- Two `done`, one `failed`, one `running`: two version labels (AC-6).
- All values at or above 0.6: labels "0.6", "0.7", "0.8", "0.9", "1.0" (AC-7).
- A precision of 0.45: lowest label "0.4" and a precision circle for that run (AC-8).
- `recall` null in the middle of three: two recall circles, no recall path (AC-9).
- Versions 5, 6, 7 give "v5", "v6", "v7" in DOM order; two runs of version 7 give two "v7" (AC-26).
- Rerender with the `running` run now `done`: one more version label (AC-20).
- "Last 3 runs" and "Last 1 run" (AC-21).
- `mouseEnter` on the band of the version-7 run with cost 0.23: the status region holds "v7", the cost string `formatUsd(0.23)` gives, the start time, "Recall 82%", "Precision 91%", "Citation 95%", "17/20 cases". The next band shows "18/22 cases" (AC-10, AC-11, AC-27).
- A run with `cost_usd` null and `recall` null: "Recall —" and the cost line ending in "—" (AC-12, EC-3, EC-10).
- A run with three null metrics keeps its band and shows three "—" (EC-4).
- `getByRole("group", { name: /Metric trend, 3 runs/ })` exists, is the only element with `tabindex="0"`, and is `document.activeElement` after `.focus()` (AC-13).
- Focus, `ArrowRight`, `ArrowRight`: the tooltip of the second plotted run; `ArrowLeft`: the first (AC-14).
- After `Escape` the region is empty; after `ArrowRight` then `fireEvent.blur` it is empty (AC-15).
- After an arrow key, `getByRole("status")` has the active run's text (AC-16).
- `runs={[]}`, and one `failed` run: heading, the `trend.empty` text, no `circle`, no tick label (AC-17, EC-1).
- `loading`: `dashboard.loading`, no circle (AC-18).
- `failed`: the error text, a button by role and name, `onRetry` called once on click, no tick label (AC-19).

Done when: `.claude/agents/scripts/check-code.sh client -- MetricTrend.test` is green with `Test Files 1`; `grep -rn "recharts" client/src/components/eval-runs` prints nothing; `grep -rnE ">[A-Z][a-z]+ [a-z]" client/src/components/eval-runs/MetricTrend --include=MetricTrend.tsx` prints nothing (NFR-5).

### Stage 3 — Tile sparklines and the two surfaces
Track: client · After: 2, and SPEC-03 stages 12 and 13 green
Files: `client/src/components/eval-runs/MetricTiles/MetricTiles.tsx`, `MetricTiles.test.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx`, `EvalsTab.test.tsx`, `client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx`, `AgentEvalView.test.tsx`
Read first:
- `client/src/components/eval-runs/MetricTiles/MetricTiles.tsx` and `MetricTiles.test.tsx` — the tile markup, and whether it is built on `MetricCard`.
- `client/src/vendor/ui/charts/Sparkline.tsx` — props; it is safe for two or more values, and a flat series divides by `span || 1` (`:18`).
- `client/src/vendor/ui/charts/MetricCard.tsx:35-47` — where its `trend` prop renders the sparkline.
- `…/EvalsTab/EvalsTab.tsx` and `EvalsTab.test.tsx` — the sibling order, the `useEvalRuns` result in scope, the fetch mock and the `running` → `done` test of SPEC-03 AC-48.
- `…/AgentEvalView/AgentEvalView.tsx` and `AgentEvalView.test.tsx` — the same.
- `client/src/components/eval-runs/index.ts`; `client/src/lib/hooks/evals.ts` — the shape `useEvalRuns` returns.

Steps:
1. `MetricTiles`: add the optional prop `sparklines?: Record<TrendMetric, number[] | null>`.
   - For recall, precision and citation accuracy, when the entry is a non-null array, render `<span aria-hidden="true" data-sparkline={key}><Sparkline data={values} color={color} w={56} h={20} /></span>` in the tile's label row.
   - `Sparkline` comes from the `@devdigest/ui` barrel; the colour from `TREND_METRICS`.
   - The cases-passed tile never gets one.
   - Without the prop the output is unchanged, so the Evals tab keeps tiles without sparklines (DR-16, `client/specs/2026-10-12-eval-trend-charts.md:182`).
2. Only if SPEC-03 stage 11 built the tiles on the vendored `MetricCard`, so that no wrapper can be placed around the sparkline:
   - pass the values through `MetricCard`'s `trend` prop and add `aria-hidden="true"` to the `<svg>` in `client/src/vendor/ui/charts/Sparkline.tsx`;
   - this is the one vendored edit, one attribute on a decorative primitive, needed for NFR-6;
   - the test then looks for `svg[aria-hidden="true"]` inside each tile;
   - report this branch in the brief's result.
3. `EvalsTab.tsx`: one import and one sibling after `<MetricTiles/>` and its `evalsTab.scoringNote` line, before `<CaseList/>`: `<MetricTrend runs={…data} loading={…isPending} failed={…isError} onRetry={() => void …refetch()} />`, from the `useEvalRuns` result the tab already holds. No `sparklines` prop on the tab's tiles. Nothing else in the file changes (AC-1).
4. `AgentEvalView.tsx`: the same `<MetricTrend …/>` between `<MetricTiles/>` and `<RunHistory/>` (AC-2), and `sparklines={metricSparklines(runs ?? [])}` on `<MetricTiles/>` (AC-22). Imports come from `@/components/eval-runs`.
5. If either surface does not render the chart slot while the run list is loading or failed (an early return above it), move nothing: report it. The chart's own states are proven in stage 2 and the surface test of AC-19 below decides.

Skills:
- `frontend-ui-architecture` → `placement.md § Sub-component ownership` — the surfaces import from the barrel, never a deep path; `devdigest.md` — `@devdigest/ui` is imported from the barrel, never a layer file.
- `react-best-practices` → `SKILL.md § Derive, Don't Store` (sparkline values computed in render), `§ Conditional Rendering`, `§ Accessibility`.
- `react-testing-library` → `SKILL.md § Query Priority`, `§ Asserting absence`; filters are file-name fragments because both paths hold a dynamic segment (`client/INSIGHTS.md § Tool & Library Notes`).

Tests to add:
- `MetricTiles.test.tsx`:
  - with `sparklines` of three values each, one `[data-sparkline]` in each of the three metric tiles and none in the cases tile, each inside `aria-hidden="true"` (AC-22, NFR-6);
  - with three nulls, no sparkline (AC-23);
  - without the prop, no sparkline (DR-16).
- `EvalsTab.test.tsx`:
  - the "Metric trend" heading follows the tiles in document order (AC-1; `compareDocumentPosition`);
  - a mocked 500 on the run list shows the chart's failure text and no tick label (AC-19);
  - in the existing `running` → `done` flow the version labels grow by one (AC-20);
  - with all runs `done`, exactly one call to `GET /agents/:id/eval-runs` per mount, the same call count after `mouseEnter` on a band and two arrow keys, and every recorded request is a `GET` (AC-25, NFR-1, NFR-2).
- `AgentEvalView.test.tsx`:
  - document order is tiles, "Metric trend", history table (AC-2);
  - three plotted runs give three sparklines, one plotted run gives none (AC-22, AC-23);
  - one call to `GET /agents/:id/eval-runs` per mount, and no new request after hover and arrow keys (AC-25, NFR-2).

Done when: `.claude/agents/scripts/check-code.sh client -- MetricTiles.test EvalsTab.test AgentEvalView.test` is green with `Test Files 3`.

### Stage 4 — Whole-package check, build on a copy, manual rings (CALLING SESSION)
Track: calling session · After: 3
Files: none
Read first: `specs/2026-10-12-eval-pipeline-plan.md:786-801` — the build-on-a-copy recipe; `client/INSIGHTS.md:82-83`.
Steps:
1. `.claude/agents/scripts/check-code.sh client` — the whole lane.
2. `next build` on a copy, exactly as SPEC-03 plan stage 15 step 3. Expected: `/eval/[agentId]` and `/agents/[id]` build. A `Can't resolve ./contracts/…js` means a value import from `@devdigest/shared`.
3. The §6 manual rows: NFR-3, NFR-4, AC-24, the focus ring.

Skills: none routed (no file is written).
Tests to add: none.
Done when: every §6 row is green or reported with its result.

## 5. Skills matrix

| Stage | frontend-ui-architecture | react-best-practices | react-testing-library |
|---|---|---|---|
| 1 | `placement.md § Sub-component ownership`, `logic.md § The placement ladder` | — (no `.tsx`) | `SKILL.md § What to Test / What to Skip` |
| 2 | `placement.md § Components`, `§ The component folder`; `boundaries.md § Barrels`; `logic.md § The placement ladder` | `SKILL.md § Derive, Don't Store`, `§ Hooks`, `§ Key Prop Patterns`, `§ Accessibility` | `SKILL.md § Query Priority` |
| 3 | `placement.md § Sub-component ownership`; `devdigest.md` (the `@devdigest/ui` barrel) | `SKILL.md § Derive, Don't Store`, `§ Conditional Rendering`, `§ Accessibility` | `SKILL.md § Query Priority`, `§ Asserting absence` |
| 4 | — | — | — |

No content trigger of `routing.md` fires: no `dangerouslySetInnerHTML`, no type assertion is planned (`entries[0]?.…` instead of a cast), and no `tsconfig` changes. An implementer who adds an `as <Type>` brings `typescript-expert` into its stage.

## 6. Verification

| Package | Command (from the repository root) | Proves |
|---|---|---|
| client | `.claude/agents/scripts/check-code.sh client` | typecheck (tests included), component and unit tests — AC-1…AC-23, AC-25…AC-27, NFR-1, NFR-2, NFR-5, NFR-6 (texts and hidden sparklines); the SPEC-03 suites unchanged (NG-5) |
| client | `next build` on a copy (stage 4 step 2) | no value import from `@devdigest/shared`; both routes build |
| client | `grep -rnE ">[A-Z][a-z]+ [a-z]" client/src/components/eval-runs/MetricTrend --include=MetricTrend.tsx` → nothing | NFR-5: no literal UI string |
| client | `grep -rn "recharts" client/src/components/eval-runs` → nothing | the library decision of §0 |
| repo | `git status --short server mcp reviewer-core client/src/vendor/shared` → no file of this feature | NFR-3 (manual ring) |
| client | `git diff client/package.json client/pnpm-lock.yaml` → empty for this feature | NFR-4 (manual ring) |
| client | `git status --short client/src/vendor/ui` → nothing, or `charts/Sparkline.tsx` alone when stage 3 step 2 applied | the vendored design system is untouched |
| manual | the user opens `/agents/<id>` (Evals tab) and `/eval/<agentId>` at the narrowest supported window width, with an agent that has several runs | AC-24, EC-13: the chart takes the container's width, no horizontal scrollbar; the `vN` labels are legible (REC1) |
| manual | Tab to the plot in a browser | NFR-6: the focus indicator is visible; Left, Right and Escape behave as AC-14 and AC-15 |

No e2e row (NG-7). No model-call row beyond the fetch assertions: the feature adds no request (AC-25).

## 7. Risks and open questions

- [blocking] Execution mode — single-agent or multi-agent. Options: single-agent (recommended) / multi-agent. Question 1.
- [non-blocking] Precondition, not a decision: stages 1–2 need SPEC-03 stages 9 and 11 green; stage 3 needs 12 and 13 green. Names read from the SPEC-03 plan and to be verified in code: `EvalRun`, `useEvalRuns` and its result fields, `completedRuns`, `toPercent`, `runs.percent`, `runs.noValue`, `runs.history.versionValue`, `evalsTab.retry`, and the props of `MetricTiles`. A different name is a rename in the stage, not a change of plan.
- [non-blocking] The library decision rests on reading `recharts` 2.15.4, not on a run. Question 2 offers the probe the spec mentions (`client/specs/2026-10-12-eval-trend-charts.md:66-70`).
- [non-blocking] Choices the source leaves open, made here and pinned by no test beyond what a `verify:` line states:
  - With no active run, Right activates the oldest run (AC-14's own check) and Left the newest.
  - The arrows clamp at the ends.
  - The pointer leaving the plot hides the tooltip.
  - The caption is shown only with a plot.
  - On the Evals tab the chart stands after the tiles' scoring note.
  - The visible tooltip is itself the live region.
  - If the user wants any of these fixed as a requirement, that goes to `spec-creator`.
- [non-blocking] Duplicate failure notices. SPEC-03 stage 12 gives each block of the Evals tab its own failure with retry. After this plan a failed run-list read may show a notice in the chart and another in the runs block. Both are required as written (AC-19, SPEC-03 AC-27). Whether they read as one too many is seen only once the SPEC-03 code exists; stage 3 reports what the tab shows.
- [non-blocking] A flex or grid parent can hold the chart wider than its pane: the `<svg>` keeps the wrapper open, so the observer never reports the smaller width. Hence `minWidth: 0` on the wrapper and `maxWidth: 100%` on the `<svg>` (stage 2 steps 5–6). This is confirmed only by the manual AC-24 row.
- [non-blocking] The `ResizeObserver` path is not exercised by any test: the stub in `client/src/test/setup.ts` never calls back. It is covered by the same manual row.
- [non-blocking] SPEC-04 is planned in parallel and edits `eval.json`, `EvalsTab.tsx` and `eval-runs/index.ts`. This plan's edits to them are additive (a new `trend` block, one JSX sibling, two export lines), but the briefs must still run one after the other (§9).

## 8. Handoff to reviewers

- Architecture:
  - A new shared component, `client/src/components/eval-runs/MetricTrend/`, props-driven and without a data hook.
  - Two functions appended to `eval-runs/helpers.ts` and a new `eval-runs/constants.ts`, so `MetricTrend` and `MetricTiles` share without importing each other.
  - One optional prop on `MetricTiles`.
  - One `useEffect` (`ResizeObserver`), the only Effect of the feature.
  - `recharts` and the vendored `LineChart` stay unused by the feature; the conditional one-attribute edit to the vendored `Sparkline.tsx` (stage 3 step 2) is worth a look if it was taken.
- Security: nothing new to review. No route, no request, no user input, no raw HTML. The feature renders numbers, a version integer and a timestamp as React text nodes (`client/specs/2026-10-12-eval-trend-charts.md:224-229`).

## 9. Execution

Mode: single-agent — questions 1–2 answered 2026-10-12 with the recommended options (the user's "take all recommended"): three briefs in a row; hand-drawn SVG, no probe. REC1 not accepted.
Recommended: single-agent. The change is one package; the three stages chain (2 needs stage 1's helpers and keys, 3 needs stage 2's component); the write sets overlap inside `client/src/components/eval-runs/`. Parallel agents would save no time.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| client | 1 | `client/messages/en/eval.json`, `client/src/components/eval-runs/{constants.ts,helpers.ts,helpers.test.ts}`, `client/src/components/eval-runs/MetricTrend/{helpers.ts,helpers.test.ts}` | SPEC-03 stages 9, 11 | alone; not beside a SPEC-04 brief that writes `eval.json` |
| client | 2 | `client/src/components/eval-runs/MetricTrend/{MetricTrend.tsx,MetricTrend.test.tsx,styles.ts,index.ts}`, `client/src/components/eval-runs/index.ts`; `RunHistory/RunHistory.tsx` and `eval-runs/{helpers,constants}.ts` only for the hoist of the time format (§3) | 1 | alone; not beside a SPEC-04 brief that writes `eval-runs/index.ts` or `RunHistory` |
| client | 3 | `client/src/components/eval-runs/MetricTiles/{MetricTiles.tsx,MetricTiles.test.tsx}`, `…/EvalsTab/{EvalsTab.tsx,EvalsTab.test.tsx}`, `…/AgentEvalView/{AgentEvalView.tsx,AgentEvalView.test.tsx}`; `client/src/vendor/ui/charts/Sparkline.tsx` only under stage 3 step 2 | 2; SPEC-03 stages 12, 13 | alone; not beside a SPEC-04 brief that writes `EvalsTab.tsx`, `EvalsTab.test.tsx` or `AgentEvalView.tsx` |
| join (calling session) | 4 | none | 3 | alone |

Order against SPEC-04: either plan may go first on a shared file, never both at once. When SPEC-04's brief for `EvalsTab.tsx` ran first, B3 reads the file as it then stands and adds its one sibling. When B3 ran first, SPEC-04's brief does the same. The calling session adds any missing message key itself if a brief reports one after stage 1.

Briefs — a fresh `implementer` per brief, in order. Each brief text is followed by the stage's own text, its `Read first` list and its `Skills` line copied from §4.
- B1 · client · stage 1 → "Execute stage 1 of client/specs/2026-10-12-eval-trend-charts-plan.md (track client). Write only inside: client/messages/en/eval.json (add the `trend` block only), client/src/components/eval-runs/constants.ts, client/src/components/eval-runs/helpers.ts, client/src/components/eval-runs/helpers.test.ts, client/src/components/eval-runs/MetricTrend/helpers.ts, client/src/components/eval-runs/MetricTrend/helpers.test.ts. Import only types from @devdigest/shared. Check with: .claude/agents/scripts/check-code.sh client -- src/components/eval-runs/MetricTrend/helpers.test src/components/eval-runs/helpers.test."
- B2 · client · stage 2 → "Execute stage 2 of client/specs/2026-10-12-eval-trend-charts-plan.md (track client). Write only inside: client/src/components/eval-runs/MetricTrend/, client/src/components/eval-runs/index.ts (two export lines); client/src/components/eval-runs/RunHistory/RunHistory.tsx and eval-runs/helpers.ts or constants.ts only to hoist the start-time format unchanged. Do not import recharts. Do not edit message files or client/src/vendor/ui; report a missing key. fireEvent only. Check with: .claude/agents/scripts/check-code.sh client -- MetricTrend.test RunHistory.test."
- B3 · client · stage 3 → "Execute stage 3 of client/specs/2026-10-12-eval-trend-charts-plan.md (track client). Write only inside: client/src/components/eval-runs/MetricTiles/, client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/{EvalsTab.tsx,EvalsTab.test.tsx}, client/src/app/eval/[agentId]/_components/AgentEvalView/{AgentEvalView.tsx,AgentEvalView.test.tsx}; client/src/vendor/ui/charts/Sparkline.tsx only under step 2, and say so. Keep the edits to EvalsTab.tsx and AgentEvalView.tsx to the import, the one MetricTrend element and the one sparklines prop. Do not edit message files. Check with: .claude/agents/scripts/check-code.sh client -- MetricTiles.test EvalsTab.test AgentEvalView.test."
- Calling session: stage 4 after B3.

single-agent: B1, B2, B3, then stage 4; the Runs column is not used.
multi-agent: the same order. No two briefs of this plan can run in parallel, so the only gain would be running beside SPEC-04 briefs that write none of the shared files.

The user's steps: the manual rows of §6 (AC-24, the focus ring), the commit and the PR.

## 10. Recommendations — not applied

- REC1 [requirements] Let the horizontal axis skip `vN` labels when run positions are closer than a label is wide, keeping the first and the last.
  - Why: AC-26 labels every run position, and EC-13 puts twenty runs into the narrower pane of the Evals tab. A 10 px mono "v12" is about 18 px wide (`charts.jsx:22` uses that size), so twenty labels need about 400 px of plot width before they touch. The tooltip and the history table still carry every version.
  - Would change: AC-26 (a superseding spec), one helper and its test in stage 1, the label loop in stage 2.
  - My recommendation: not now. Build AC-26 as written and decide after the manual AC-24 check shows whether the labels collide in the real pane.

## Questions for the user
The calling session asks these with AskUserQuestion and sends the answers back; the implementer does not start before every [blocking] one is answered. By the user's delegation ("take all recommended") the recommended option is taken for each.
1. [blocking] Execution mode — single-agent or multi-agent?
   - single-agent (recommended) — one package, three chained stages, overlapping write sets inside `client/src/components/eval-runs/`; three briefs one after another, then the calling session's stage 4.
   - multi-agent — the same three briefs in the same order; nothing in this plan runs in parallel, so it adds coordination and no speed.
2. [non-blocking] The chart library — accept the decision made from the `recharts` source, or run the probe test first?
   - hand-drawn SVG, no probe (recommended) — the keyboard evidence (`AccessibilityManager.js:39-70`, `generateCategoricalChart.js:1930-1946`) does not depend on jsdom, so a probe cannot change the outcome; it saves one implementer run.
   - run the probe as an extra first brief — one throwaway test rendering a `recharts` line chart with a marker and a tooltip under jsdom, deleted afterwards. Stages 1–3 stand unchanged whatever it prints, because the spec's rule takes hand-drawn SVG when the library offers no keyboard path.

Recommendations awaiting a decision: REC1 (section 10) — recommended answer: not now; the plan stands as written.
Gaps for `spec-creator`, not questions of mine: none.
