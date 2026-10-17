# Spec: Eval trend charts
Spec ID: SPEC-05
Status: implemented
Supersedes: none

## Problem and user

An **agent author** who edits a reviewer agent's prompt reads the effect of the edit from
the eval runs of SPEC-03 (`specs/2026-10-12-eval-pipeline.md`): the metric tiles show the
newest completed run against the previous one, and the compare view shows two chosen runs
side by side. Both show a jump between two runs. Neither shows the dynamics — whether
precision degrades slowly from version to version is visible only when every run stands
next to the others (IN-1: «Порівняння двох прогонів показує стрибок, але не динаміку»).

A **repo owner** pays for model calls, so looking at the dynamics has to cost nothing
(IN-2, SPEC-03 US-12).

SPEC-03 leaves this out on purpose and names the seam: its NG-2 excludes the METRIC TREND
chart, the tile sparklines, the dashboard-row sparklines and the "30 days" control, and
its AC-64 makes the run list carry what a trend needs (IN-6). This spec fills that seam and
changes nothing SPEC-03 defines.

Nothing of SPEC-03 exists in the code yet: there is no eval module under
`server/src/modules/`, no `/eval` route in `client/src/app/` and no Evals tab (IN-7). The
feature of this spec is built on SPEC-03's surfaces and its run list, after they land.

References to SPEC-03 are written with the prefix, as "SPEC-03 AC-64"; an ID without the
prefix belongs to this spec.

## Goals / Non-goals

- **G-1** An agent author sees how recall, precision and citation accuracy of one agent moved across that agent's eval runs, as a chart with one point per run.
- **G-2** An agent author reads from a run's point which prompt version that run used and what it cost.
- **G-3** The values behind the chart are reachable from the keyboard and by a screen reader.
- **G-4** Looking at the trend starts no model call and adds no request to the ones SPEC-03's screens already send.

- **NG-1** Thresholds, a threshold line on the chart, alerts and any gating on a metric — the homework's key idea is to look at the dynamics first and introduce thresholds later (IN-1 line 100; SPEC-03 NG-9).
- **NG-2** A new API route, a new query parameter, a contract change, and any use of the reserved `EvalTrendPoint` and `EvalDashboard.trend` declarations — the run list of SPEC-03 AC-64 already carries the status, start time, agent version, three metrics and cost of every run it returns, so the feature is client-only (IN-2, IN-6, DR-8).
- **NG-3** A sparkline on each agent row of the Eval Dashboard list — that response holds one newest completed run per agent, so a row's history needs a server change or one request per row (IN-4, IN-6).
- **NG-4** The "30 days" range control — the prototype's button has no handler, and the chart is bounded by the run list, not by dates (IN-3).
- **NG-5** Changing what SPEC-03 defines: the metric formulas, the run list and its cap, the tiles' values and differences, the precision banner, the run history table and the compare view — SPEC-03's contracts, routes and non-goals are fixed for this spec (IN-2).
- **NG-6** A trend across several agents on one chart, and a trend for a skill's cases — the homework asks for the runs of one agent (IN-1).
- **NG-7** A browser e2e flow — not in the homework; SPEC-03 NG-8 leaves e2e out for the whole eval feature (IN-6).

## User stories

- **US-1** As an agent author, I want a chart of recall, precision and citation accuracy over the runs of an agent on the agent's Evals tab, so that I see a slow degradation that two neighbouring runs do not show.
- **US-2** As an agent author, I want the same chart on the agent's eval view of the Eval Dashboard, so that I read the trend where the design places it, next to the run history.
- **US-3** As an agent author, I want a run's point to tell me the prompt version and the cost of that run, so that I tie a change of a metric to the version that caused it.
- **US-4** As an agent author who works without a pointer or without sight of the graphic, I want to reach each run's values from the keyboard, so that the chart does not hide data from me.
- **US-5** As an agent author, I want a small trend line in each metric tile of the agent's eval view, so that I see the direction of a metric before I read the chart.
- **US-6** As a repo owner, I want the trend to be drawn from stored runs, so that opening it starts no model call.
- **US-7** As an agent author, I want the chart to stay truthful when there is little or partial data, so that I do not read a missing value as a zero or an unfinished run as a result.

## Acceptance criteria (EARS)

Terms. **The trend chart** is the block this spec adds: a heading, a legend, the plot and a
caption. **The run list** is the response of `GET /agents/:id/eval-runs` (SPEC-03 AC-64),
which the Evals tab and the agent's eval view read for their run history table. A
**plotted run** is a run of the run list in status `done`; plotted runs are ordered by
`started_at`, oldest first. A **run position** is the place of one plotted run on the
horizontal axis. The **active run** is the plotted run whose tooltip is shown. Metric
values are the `recall`, `precision` and `citation_accuracy` of the run record (SPEC-03
§ Contracts), each a number from 0 to 1 or null.

The `component` ring of AC-4…AC-16, AC-26 and AC-27 rests on one assumption: the plot,
its markers, its tooltip and its keyboard path render under jsdom. The plan checks that
for the client's existing chart library with one probe test; when the library does not
render there or offers no keyboard path, the plot is drawn by hand in SVG and the ring
stands (IN-9, NFR-4).

### Where the chart is

- **AC-1** [ubiquitous] The Evals tab shall show the trend chart of the agent after the metric tiles. — covers: US-1 · verify: component — the chart's heading follows the tiles in the rendered tab
- **AC-2** [ubiquitous] The agent's eval view shall show the trend chart of the agent between the metric tiles and the run history table. — covers: US-2 · verify: component — the order tiles, chart heading, history table
- **AC-3** [ubiquitous] The trend chart shall show the heading "Metric trend" and a legend that names its three series "Recall", "Precision" and "Citation" in text. — covers: US-1 · verify: component — the four strings of the `eval` namespace

### What is plotted

- **AC-4** [ubiquitous] The trend chart shall draw, for each of the three metrics, one marker at the run position of every plotted run whose value of that metric is not null, with the run positions evenly spaced and ordered oldest first from left to right. — covers: US-1 · verify: component — three plotted runs give three markers per series, and the first marker of a series belongs to the oldest run
- **AC-5** [ubiquitous] The trend chart shall connect the markers of one metric at neighbouring run positions with a line. — covers: US-1 · verify: component — three plotted runs give one line per series; one plotted run gives markers and no line
- **AC-6** [ubiquitous] The trend chart shall plot only the runs of the run list that are in status `done`. — covers: US-7 · verify: component — a run list of two `done`, one `failed` and one `running` run gives two run positions
- **AC-7** [ubiquitous] The trend chart shall scale its vertical axis from 0.6 to 1.0 with a labelled gridline at each tenth. — covers: US-1 · verify: component — the tick labels 0.6, 0.7, 0.8, 0.9, 1.0 for runs whose values are all at or above 0.6
- **AC-8** [unwanted] IF a plotted value is lower than 0.6, THEN the trend chart shall lower the bottom of its vertical axis to the highest tenth that is not above the lowest plotted value. — covers: US-7 · verify: component — a precision of 0.45 gives a lowest tick label of 0.4 and a marker for that value
- **AC-9** [unwanted] IF a metric of a plotted run is null, THEN the trend chart shall draw for that metric no marker at that run position and no line to or from it. — covers: US-7 · verify: component — three runs with `recall` null in the middle one give two recall markers and no recall line
- **AC-26** [ubiquitous] The trend chart shall label each run position on the horizontal axis with that run's agent version as `vN`. — covers: US-1 · verify: component — plotted runs of versions 5, 6 and 7 give the axis labels "v5", "v6", "v7" from left to right; two runs of version 7 give two "v7" labels
- **AC-20** [event-driven] WHEN a run of the run list changes from `running` to `done`, the trend chart shall show that run's markers without a page reload. — covers: US-7 · verify: component — a run-list read that changes from `running` to `done` adds one run position
- **AC-21** [ubiquitous] The trend chart shall show a caption "Last N runs", where N is the number of plotted runs. — covers: US-1 · verify: component — "Last 3 runs" for three plotted runs and "Last 1 run" for one

### The tooltip

- **AC-10** [event-driven] WHEN the pointer is over a run position, the trend chart shall show a tooltip that holds that run's agent version as `vN` and its cost. — covers: US-3 · verify: component — pointing at the run of version 7 with cost 0.23 shows "v7" and the cost as the run history table formats it
- **AC-11** [ubiquitous] The trend chart shall show in the tooltip, besides the version and the cost, the run's start time and its recall, precision and citation accuracy as whole percentages, each named in text. — covers: US-3 · verify: component — the tooltip of a run holds its start time, "Recall 82%", "Precision 91%" and "Citation 95%"
- **AC-27** [ubiquitous] The trend chart shall show in the tooltip the run's cases passed of cases covered as "P/T cases", from the run's `cases_passed` and `cases_total`. — covers: US-3 · verify: component — a run with 17 of 20 shows "17/20 cases"; the next run with 18 of 22 shows "18/22 cases"
- **AC-12** [unwanted] IF the cost or a metric of the active run is null, THEN the trend chart shall show "—" in the tooltip in place of that value. — covers: US-3 · verify: component — a run with `cost_usd` null and `recall` null

### Keyboard and screen reader

- **AC-13** [ubiquitous] The trend chart shall expose its plot as one keyboard tab stop whose accessible name holds "Metric trend" and the number of plotted runs. — covers: US-4 · verify: component — one focusable element found by role and name; it takes `.focus()`
- **AC-14** [state-driven + event-driven] WHILE the plot has keyboard focus, WHEN the Left or the Right arrow key is pressed, the trend chart shall make the previous or the next plotted run the active run and show its tooltip. — covers: US-4 · verify: component — focus, Right, Right shows the tooltip of the second plotted run; Left shows the first
- **AC-15** [event-driven] WHEN the Escape key is pressed or keyboard focus leaves the plot, the trend chart shall hide the tooltip. — covers: US-4 · verify: component — the tooltip text is absent after Escape and after blur
- **AC-16** [event-driven] WHEN the active run changes, the trend chart shall expose the tooltip's text through a live region. — covers: US-4 · verify: component — the live region's text equals the tooltip's after an arrow key

### States

- **AC-17** [state-driven] WHILE the run list holds no plotted run, the trend chart shall show its heading and a text that the trend appears after the agent's first completed run, with no axis and no marker. — covers: US-7 · verify: component — an empty run list, and a run list of one `failed` run
- **AC-18** [state-driven] WHILE the run list is loading, the trend chart shall show the loading text of the `eval` namespace in place of the plot. — covers: US-7 · verify: component — a pending request
- **AC-19** [unwanted] IF the read of the run list fails, THEN the trend chart shall show the failure state with the retry control that SPEC-03 AC-27 defines, in place of the plot. — covers: US-7 · verify: component — a mocked 500 shows the failure and no axis

### Tile sparklines and layout

- **AC-22** [ubiquitous] The agent's eval view shall show in each of its recall, precision and citation accuracy tiles a sparkline of that metric's non-null values over the plotted runs, oldest first. — covers: US-5 · verify: component — three plotted runs give one sparkline in each of the three tiles
- **AC-23** [unwanted] IF a metric has fewer than two non-null values over the plotted runs, THEN the agent's eval view shall show that metric's tile without a sparkline. — covers: US-5 · verify: component — one plotted run gives three tiles and no sparkline
- **AC-24** [ubiquitous] The trend chart shall take the width of its container on the Evals tab and on the agent's eval view, without a horizontal scrollbar. — covers: US-1 · verify: manual — layout is not computed in jsdom; the user opens both surfaces at the narrowest supported window width

### No model call

- **AC-25** [ubiquitous] The trend chart shall render from the run list its surface already reads and send no request of its own. — covers: US-6 · verify: component — the mocked `fetch` records one `GET /agents/:id/eval-runs` for the surface and no further request after hovering and arrow keys

## Edge cases

- **EC-1** The agent has no run, or only failed runs → the heading and the empty text, no plot — covered by: AC-17
- **EC-2** Exactly one plotted run → one marker per metric and no line; the tooltip works; no tile sparkline — covered by: AC-4, AC-5, AC-23
- **EC-3** A completed run has a null metric (a set of `must_not_flag` cases only has no recall, SPEC-03 AC-58) → a gap in that series, "—" in the tooltip, never a point at 0 — covered by: AC-9, AC-12
- **EC-4** A completed run has three null metrics (every case errored, SPEC-03 EC-15) → the run keeps its run position with no marker, and its tooltip shows the version, the cost and three "—" — covered by: AC-9, AC-12
- **EC-5** A run failed (SPEC-03 AC-42) → not plotted — covered by: AC-6
- **EC-6** A run is in progress → not plotted until it is `done`, then added without a reload — covered by: AC-6, AC-20
- **EC-7** The agent has more than 20 runs → the run list returns the 20 newest (SPEC-03 AC-64), so older runs are not on the chart, while the homework says "over all runs"; the caption says how many runs are plotted — covered by: AC-21
- **EC-8** A metric falls under 0.6, as in the homework's deliberately broken prompt → the axis extends down and the value is drawn — covered by: AC-8
- **EC-9** Several runs carry the same agent version (a re-run, or a skill change that creates no version, SPEC-03 EC-23) → one run position each; the start time in the tooltip tells them apart — covered by: AC-4, AC-11
- **EC-10** The run's cost is null (a model without a price, SPEC-03 EC-24) → "—" in the tooltip — covered by: AC-12
- **EC-11** Every value of a metric is the same → a horizontal line and a flat sparkline — covered by: AC-5, AC-22
- **EC-12** The read of the run list fails → the failure state in place of the plot — covered by: AC-19
- **EC-13** Twenty plotted runs in the narrower pane of the Evals tab → the chart takes the pane's width — covered by: AC-24
- **EC-14** Cases were added or deleted between runs, so neighbouring points are computed over different case sets and the line reads as a change of the agent → the tooltip of each run shows its cases passed of covered, so a changed case set is visible — covered by: AC-27

## Non-functional requirements

- **NFR-1** [cost] Showing the trend chart, its tooltip and the tile sparklines starts no model call: the client sends no `POST` and no request to a run-starting route while they render and while a run becomes active. — verify: component — the mocked `fetch` records only `GET` requests across render, hover and arrow keys
- **NFR-2** [performance] A surface that shows the trend chart and the run history table reads the run list once for both. — verify: component — one request to `GET /agents/:id/eval-runs` per mount of the Evals tab and of the agent's eval view
- **NFR-3** [compatibility] The feature changes nothing under `server/`, `mcp/`, `reviewer-core/` and neither `@devdigest/shared` copy; the reserved `EvalTrendPoint` and `EvalDashboard` declarations are left to SPEC-03 NFR-7. — verify: manual — `git status --short server mcp reviewer-core client/src/vendor/shared` lists no file of this feature; a test does not read the working tree
- **NFR-4** [compatibility] The feature adds no dependency to `client/package.json`. — verify: manual — `git diff client/package.json client/pnpm-lock.yaml` is empty for this feature
- **NFR-5** [i18n] Every string of the feature comes from `client/messages/en/eval.json`, reusing `dashboard.metricTrend` and `dashboard.legend.*`; the run count in the caption and in the accessible name uses ICU plural forms; the start time, the percentages and the cost are formatted as the run history table of SPEC-03 AC-66 formats them. — verify: component — tests render with the real message file; `grep -rn` finds no literal UI string in the feature's components
- **NFR-6** [accessibility] Each series is named in text in the legend and in the tooltip, so that no value is told by colour alone; the plot shows a visible focus indicator; the tile sparklines are hidden from assistive technology, the tile's value and difference carrying their meaning. — verify: component — the tooltip and legend texts, and no accessible node for a sparkline; the focus indicator is checked by the user in a browser

## Module interactions

Packages: client
Surfaces: the trend chart on the Evals tab of the agent editor and on the agent's eval view under `/eval`; the sparklines in the three metric tiles of the agent's eval view

| # | From → To | Channel | Carries | Exists today | If it fails |
|---|---|---|---|---|---|
| MI-1 | client → server | `GET /agents/:id/eval-runs`, read by the surface for its run history table | per run: `status`, `started_at`, `agent_version`, `recall`, `precision`, `citation_accuracy`, `cost_usd`; newest first, at most 20, without `results` | new — defined by SPEC-03 AC-64 and its Eval run record; no eval route exists in `server/src/modules/` yet, so SPEC-03 lands first | the failure state with a retry control in place of the plot (AC-19) |

The client owns nothing here: the run list is SPEC-03's data, read through the one hook
the surface already uses and never fetched a second time (NFR-2). The chart relies on the
run record's fields being nullable as SPEC-03 § Contracts states them. Existing callers of
the route — the run history table, the tiles, the banner — keep what they get; `mcp/`
reads no eval route (SPEC-03 MI-14).

## Design review

Sources reviewed: IN-3, IN-4, IN-5

| # | Kind | Finding | Proposal | Decision |
|---|---|---|---|---|
| DR-1 | inconsistency | IN-1 puts the chart «на вкладці Evals»; IN-3 draws it on the agent's eval view of the Eval Dashboard, and IN-5 draws the Evals tab with tiles and no chart | Show it on both through one shared block, as SPEC-03 DR-4 does with the run history table: the homework is satisfied on the Evals tab and the design on the eval view, and both surfaces already read the run list | accepted → AC-1, AC-2 |
| DR-2 | inconsistency | IN-3 marks only the last point of each series (`docs/design/Dev Digest 2/Dev Digest/charts.jsx:27`); IN-1 says «точка = прогін» | A marker for every run | accepted → AC-4 |
| DR-3 | missing state | Neither IN-3 nor the prototype's `LineChart` (`charts.jsx:12-29`) has a tooltip; IN-1 names its content as the version and the cost. Several runs share one version (SPEC-03 EC-22, EC-23), so the version alone does not identify a run | Version and cost as stated, plus the start time and the three values; the model is left out, because a model change already creates a new agent version | accepted → AC-10, AC-11 |
| DR-4 | corner case | IN-3 fixes the axis at 0.6–1.0 (`charts.jsx:12`, `:18`), and the client's chart primitive has the same default (`client/src/vendor/ui/charts/LineChart.tsx:22`); a value under 0.6 falls outside the plot, and the homework's own experiment — a deliberately broken prompt — produces one. A fixed 0–1 axis flattens the one-or-two-point drift the homework wants to be seen | Keep 0.6–1.0 as drawn and extend the bottom by whole tenths when a value is lower; the tick labels stay visible so the cut axis is readable | accepted → AC-7, AC-8 |
| DR-5 | corner case | The client's chart primitive takes `number[]` and plots a missing value as 0 (`client/src/vendor/ui/charts/LineChart.tsx:35`); SPEC-03 metrics are null on a zero divisor | A gap: no marker and no line through the missing value | accepted → AC-9 |
| DR-6 | missing state | No frame shows the chart with no run, with one run, while loading, or after a failed read. With one value the prototype's and the client's sparkline divide by zero (`charts.jsx:5`, `client/src/vendor/ui/charts/Sparkline.tsx:19`), as does the prototype's chart (`charts.jsx:16`) | An empty text without a plot; markers without a line for one run; no sparkline under two values; SPEC-03's loading and failure states | accepted → AC-17, AC-18, AC-19, AC-23 |
| DR-7 | module | IN-1 says «по всіх прогонах агента»; SPEC-03 AC-64 returns the 20 newest runs, and SPEC-03 is approved with that cap | Plot the runs the list returns and say so in a caption; lifting the cap is a change of SPEC-03, not of this spec | accepted → AC-21 |
| DR-8 | module | The reserved `EvalTrendPoint` and `EvalDashboard.trend` (`server/src/vendor/shared/contracts/eval-ci.ts:57`, `:85`, the client copy alike) have non-nullable metrics and no agent version, and nothing writes them; the SPEC-03 run list carries every field the chart and its tooltip need | Do not use them; draw from the run list | accepted → NFR-3 |
| DR-9 | module | IN-4 draws a sparkline on every agent row (recall only, `docs/design/Dev Digest 2/Dev Digest/screen_skills.jsx:375`); `GET /eval/dashboard` returns one newest completed run per agent (SPEC-03 AC-82) | Not included; if taken, it changes the server and moves this spec to the root folder | rejected — the user left it out (IN-9); it stays a named non-goal, NG-3 |
| DR-10 | ux | IN-3 draws a "30 days" control; in the prototype it is a button without a handler (`screen_skills.jsx:432`) | Not included | rejected — the user left it out (IN-9); it stays a named non-goal, NG-4 |
| DR-11 | ux | IN-3 has no label on the horizontal axis (the primitive hides it, `client/src/vendor/ui/charts/LineChart.tsx:44`), so a point's version is known only from the tooltip, while the homework's question is how a metric moves «від версії до версії» | Label each run position with its agent version as `vN` | accepted → AC-26 |
| DR-12 | ux | SPEC-03's compare view recomputes over the cases common to two runs (SPEC-03 AC-72); the chart plots each run's stored metrics, so a change of the case set reads as a change of the agent | Show "P/T cases" of the run in the tooltip, from `cases_passed` and `cases_total` | accepted → AC-27 |
| DR-13 | module | The client already has chart primitives: `LineChart` on `recharts` (`client/package.json:21`) with no tooltip, no per-run marker, a hidden horizontal axis and no keyboard path, and `Sparkline` drawn by hand in SVG; both are used only by the showcase (`client/src/components/showcase/Showcase.tsx:202-205`) and neither has a test | No new dependency; whether the existing primitive is extended or the plot is drawn in SVG is the plan's choice | accepted → NFR-4 |
| DR-14 | inconsistency | IN-3 labels the axis in fractions (0.6 … 1.0) while the tiles and the history table show percentages | Keep the axis as drawn; the tooltip uses percentages, as the tiles do | accepted → AC-7 |
| DR-15 | missing state | No source shows how the chart is used from the keyboard or read by a screen reader; the run history table under it holds the same values as text on both surfaces (SPEC-03 AC-66, AC-89) | One tab stop, arrow keys between runs, the tooltip's text in a live region; the history table stays the full text alternative | accepted → AC-13, AC-14, AC-15, AC-16, NFR-6 |
| DR-16 | inconsistency | IN-3 draws a sparkline in each metric tile of the agent's eval view; IN-5 draws the Evals tab's tiles without one | Sparklines in the eval view's tiles only | accepted → AC-22 |

## Inputs and provenance

| # | Source | Kind | Used for |
|---|---|---|---|
| IN-1 | homework text, `course-materials/materials/lesson6/hw6_description.txt:94-100`: «Тренд-графіки метрик» · «Порівняння двох прогонів показує стрибок, але не динаміку: чи деградує precision повільно від версії до версії, видно тільки на графіку.» · «Графік recall / precision / citation_accuracy по всіх прогонах агента на вкладці Evals; точка = прогін, тултіп = версія промпта і вартість.» · «Ключова ідея: «CI-як-тренд» з теорії — спершу дивимося динаміку, пороги вводимо потім.» | user text | Problem, G-1, G-2, US-1, US-3, AC-1, AC-4, AC-10, NG-1, NG-6 |
| IN-2 | task text of the calling session, 2026-10-12: SPEC-05; the spec extends SPEC-03, whose contracts, routes and non-goals are fixed; `client/specs/` when the data SPEC-03 serves is enough; the spec covers the chart's states, the tooltip content, keyboard and screen-reader access, the y-axis rule and that opening the chart makes no model call; a new dependency is a decision to raise; where no source answers, the recommended default is written and marked | user text | G-3, G-4, US-4, US-6, US-7, AC-25, NG-2, NG-5, NFR-1, NFR-3, placement of the file |
| IN-3 | `course-materials/materials/lesson6/i/img_2.png` (the agent's eval view: three tiles with a sparkline and a difference, METRIC TREND with a 0.6–1.0 axis, three series, a legend, end-point markers, "30 days") with `docs/design/Dev Digest 2/Dev Digest/screen_skills.jsx:395-455` and `charts.jsx:3-29`, `:57-69` | figma export | US-2, US-5, AC-2, AC-3, AC-5, AC-7, AC-22, AC-24, DR-1…DR-6, DR-10, DR-11, DR-14, DR-16 |
| IN-4 | `course-materials/materials/lesson6/i/img_1.png` (the Eval Dashboard list, a sparkline per agent row) with `docs/design/Dev Digest 2/Dev Digest/screen_skills.jsx:375` | figma export | NG-3, DR-9 |
| IN-5 | `course-materials/materials/lesson6/i/img_4.png` (the agent editor's Evals tab: four tiles, the case list, no chart) | figma export | DR-1, DR-16 |
| IN-6 | `specs/2026-10-12-eval-pipeline.md` — SPEC-03, read in full as a draft and `Status: approved` since 2026-10-12 with its contracts and its cap of the 20 newest runs unchanged (IN-9): NG-2 (the seam), AC-27, AC-48, AC-58, AC-60, AC-62, AC-64, AC-66, AC-82, AC-88, AC-89, EC-15, EC-22…EC-24, NFR-7, NFR-13, § Contracts (the Eval run record) | repository | Problem, the terms, MI-1, AC-12, AC-18, EC-3…EC-10, NG-2, NG-7, DR-7, DR-9, DR-12 |
| IN-7 | `client/src/vendor/ui/charts/LineChart.tsx`, `Sparkline.tsx`, `MetricCard.tsx`, `client/src/vendor/ui/README.md`, `client/src/components/showcase/Showcase.tsx`, `client/package.json`, `client/messages/en/eval.json`, `client/src/test/setup.ts`, `server/src/vendor/shared/contracts/eval-ci.ts` and its copy under `client/src/vendor/shared/contracts/` @ 1d4e77f; `server/src/modules/` and `client/src/app/` hold no eval module or route | code | Problem, AC-3, AC-18, NFR-5, DR-4…DR-6, DR-8, DR-11, DR-13 |
| IN-8 | `INSIGHTS.md` (`i/` is scratch — cite the JSX prototype next to an export; the starter pre-wires a lesson), `client/INSIGHTS.md` (no `user-event`: keyboard operability is proven by role, name and `.focus()`; `{x, number}`), `AGENTS.md`, `client/AGENTS.md`, `TESTING.md` § Suite map | repository | NFR-5, the `verify:` rings, the hints of AC-13…AC-15 |
| IN-9 | answers, 2026-10-12, relayed by the calling session — the user chose "take all recommended" (AskUserQuestion, option «Бери рекомендовані сам»): the chart on both surfaces as one shared block; the 0.6–1.0 axis extended by whole tenths; completed runs only; a gap for a null metric; the tooltip with version, cost, start time and the three metrics; the keyboard path; the listed states for no run, one run and a failed read; the runs the list returns, captioned "Last N runs"; no new dependency. Proposals: the sparkline per dashboard row and the "30 days" control rejected and kept as named non-goals; `vN` labels on the horizontal axis and "P/T cases" in the tooltip accepted. The `recharts`-under-jsdom question is not researched: the plan settles it with one probe test and takes hand-drawn SVG when the library does not render or offers no keyboard path. SPEC-03 is `Status: approved`, contracts unchanged, its cap of the 20 newest runs stands | user answer | AC-6…AC-9, AC-11, AC-13…AC-17, AC-19…AC-21, AC-23, AC-26, AC-27, NG-3, NG-4, NFR-4, NFR-6, EC-1…EC-9, EC-12, EC-14, the `component` ring assumption |

| Items | Origin | Source |
|---|---|---|
| G-1, G-2 | stated | IN-1 |
| G-3, G-4 | stated | IN-2 |
| NG-1, NG-6 | stated | IN-1 |
| NG-2, NG-5 | stated | IN-2 |
| NG-3, NG-4 | stated | IN-9 |
| NG-7 | stated | IN-6 (SPEC-03 NG-8) |
| US-1, US-3 | stated | IN-1 |
| US-2, US-5 | design | IN-3 |
| US-4, US-6, US-7 | stated | IN-2 |
| AC-1, AC-4, AC-10 | stated | IN-1 |
| AC-2, AC-3, AC-5, AC-22, AC-24 | design | IN-3; IN-7 for the reserved strings |
| AC-6…AC-9, AC-11, AC-13…AC-17, AC-19…AC-21, AC-23 | stated | IN-9 (the defaults of the first draft, confirmed); IN-3 for the 0.6–1.0 range of AC-7 |
| AC-12 | design | IN-6 (SPEC-03 AC-62, from the prototype's "—") |
| AC-18 | code | IN-7 (`client/messages/en/eval.json:4`) |
| AC-25 | stated | IN-2 |
| AC-26, AC-27 | stated | IN-9 (the proposals DR-11 and DR-12, accepted) |
| EC-1…EC-9, EC-12, EC-14 | stated | IN-9 |
| EC-10 | design | IN-6 (SPEC-03 EC-24) |
| EC-11, EC-13 | design | IN-3 |
| NFR-1, NFR-3 | stated | IN-2 |
| NFR-2 | code | IN-6 (both surfaces read the run list for the history table) |
| NFR-4, NFR-6 | stated | IN-9 |
| NFR-5 | code | IN-7, IN-8 |

## Untrusted inputs

None — the chart, its tooltip and the sparklines show numbers and timestamps the API
computed and stored for a run (`agent_version`, `started_at`, the three metrics,
`cost_usd`); no pull-request text, finding text, case name or prompt text is rendered by
this feature, and it sends nothing to a model, to SQL or to a URL.

## Traceability

| Goal | Stories | Criteria | Edge cases | NFR |
|---|---|---|---|---|
| G-1 | US-1, US-2, US-5, US-7 | AC-1…AC-9, AC-17…AC-24, AC-26 | EC-1…EC-8, EC-11…EC-13 | NFR-5 |
| G-2 | US-3 | AC-10…AC-12, AC-27 | EC-9, EC-10, EC-14 | — |
| G-3 | US-4 | AC-13…AC-16 | — | NFR-6 |
| G-4 | US-6 | AC-25 | — | NFR-1, NFR-2 |
| — | — | — | — | NFR-3, NFR-4 |

## Open questions

None — every question of the first draft was answered on 2026-10-12 (IN-9), and the answers
stand in the sections they changed.
