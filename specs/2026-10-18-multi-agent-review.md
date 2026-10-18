# Spec: Multi-Agent Review
Spec ID: SPEC-11
Status: approved
Supersedes: none

## Problem and user

A reviewer reading a pull request can run one agent, or every enabled agent, from the PR page
(`client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx`),
but cannot pick a set of agents for one run, see what that run will cost, or compare the agents'
results side by side. Each agent's run lands as an unrelated `agent_runs` row: nothing ties the
runs of one click together (`multi_agent_runs` is an empty stub, `server/src/db/schema/runs.ts`),
the same problem found by two agents is listed twice (server `INSIGHTS.md`, "Findings are never
deduplicated"), and the sidebar's Multi-Agent Review entry leads nowhere. The L07 lab (IN-1)
asks for this as worktree A, built in parallel with Export to CI (worktree B), which reads which
agent produced a finding. Agents of the same team also need a fixed contract for that
attribution before both worktrees start.

## Goals / Non-goals

- **G-1** A reviewer starts a review of one PR by a chosen set of agents in one action, sees its time and cost estimate first, and the runs are stored as one multi-agent run.
- **G-2** A reviewer compares the agents of one multi-agent run: per-agent columns with live status, a tabbed detail view with finding actions, grouped findings with their authors, and where the agents disagree.
- **G-3** A reviewer opens the trace of each agent's run from the results and reads its tokens, cost and grounding gate decision there.
- **G-4** Opening Multi-Agent Review shows the newest multi-agent run of the repository, with a way to start a new one.
- **G-5** Export to CI (worktree B) relies on one written contract for which agent and which run produced a finding.
- **G-6** The cost and time of one agent against three agents on the same PR is recorded from measured numbers.
- **NG-1** A second review executor, trace drawer, log viewer or finding card — the existing `run-executor`, `RunTraceDrawer`, `LiveLogStream` and `FindingCard` are reused; the user asked for the simplest implementation.
- **NG-2** Any change under `server/src/modules/ci/`, `agent-runner/`, the CI Runs page or the agent's CI tab — those belong to worktree B.
- **NG-3** An explanation of why an agent did not flag a group — nothing produces one without an extra model call per agent; the cell reads "did not flag" only.
- **NG-4** A list of older multi-agent runs — only the newest one and a run opened by its URL are shown.
- **NG-5** "Reply to author" on a finding (shown in IN-6) — not in the lab requirements.
- **NG-6** Grouping by text similarity of findings — no threshold has a source; grouping uses file and line ranges only.
- **NG-7** Reading memory rows written by Learn into a prompt — nothing reads the `memory` table today, and this feature does not start to.
- **NG-8** Per-agent colours and icons from the design — agents carry neither; every agent uses one neutral icon.
- **NG-9** A new migration beyond one nullable column on `agent_runs` — the only link the stub table lacks.

## User stories

- **US-1** As a reviewer on the PR page, I want to tick the agents to run and start them together, so that I do not start them one by one.
- **US-2** As a reviewer, I want a Configure run screen with the PR, the agent checkboxes and an estimate from past runs, so that I know the time and cost before I start.
- **US-3** As a reviewer, I want one column per agent with its own live status, so that a slow or failed agent does not hide the others' results.
- **US-4** As a reviewer, I want a tabbed detail view per agent where I can act on each finding, so that I triage without going back to the PR page.
- **US-5** As a reviewer, I want findings that several agents raised on the same lines grouped, with each author and its original finding kept, so that I see agreement without losing who said what.
- **US-6** As a reviewer, I want to see where agents disagree, including the agents that did not flag a place, and to filter to conflicts only, so that I review the contested spots first.
- **US-7** As a reviewer, I want to open each agent's run trace from its column or tab, so that I can explain its tokens, cost and grounding decision.
- **US-8** As a reviewer, I want Multi-Agent Review to open on the newest run with a "Start new review" button, so that I return to results instead of starting a run every time.
- **US-9** As a developer of the Export to CI ingest (worktree B), I want a fixed attribution contract for findings, so that CI results show which agent and run produced each finding.
- **US-10** As a lab author, I want the numbers of one agent against three agents recorded as measured, so that the conclusion is not fitted to an expected 3×.

```mermaid
flowchart LR
  PR[PR page] -->|tick agents, Run| API[API]
  NAV[Sidebar: Multi-Agent Review] -->|newest run exists| RES[Results page]
  NAV -->|no run yet| CFG[Configure run screen]
  RES -->|Start new review| CFG
  CFG -->|Run| API
  API -->|returns run id| RES
  RES -->|View trace| DRW[Run trace drawer]
```

## Acceptance criteria (EARS)

- **AC-1** [event-driven] WHEN the reviewer opens the Run Review menu, the PR page shall list every agent of the workspace with a checkbox, with the enabled agents checked. — covers: US-1 · verify: component — menu items, checkbox states for an enabled and a disabled agent
- **AC-2** [ubiquitous] The PR page shall label the menu's run button "Select agents" and disable it when no agent is checked, "Run 1 agent" when one is, and "Run multi-agent review (N)" when N > 1 are. — covers: US-1 · verify: component — button text and disabled state after checking 0, 1 and 2 agents
- **AC-3** [event-driven] WHEN the reviewer clicks the menu's run button, the PR page shall send `POST /pulls/:id/multi-agent-run` with exactly the checked agent ids and open the results page of the returned run. — covers: US-1 · verify: component — mocked fetch body and the router push to `/repos/:repoId/multi-agent/:runId`
- **AC-4** [state-driven] WHILE no pull request is selected, the Configure run screen shall show "Pick a pull request first" in place of the agent list and keep the run button disabled. — covers: US-2 · verify: component — placeholder text and disabled button
- **AC-5** [event-driven] WHEN a pull request is selected, the Configure run screen shall list every agent of the workspace with a checkbox, its name, its description and its estimate as duration · cost. — covers: US-2 · verify: component — one row per mocked agent with the estimate text
- **AC-6** [unwanted] IF an agent has no finished run, THEN the Configure run screen shall show "no estimate" for that agent and leave it out of the total. — covers: US-2 · verify: component — row text and total with one agent lacking an estimate
- **AC-7** [state-driven] WHILE at least one agent is checked, the Configure run screen shall show the total as "≈ <longest duration> · <sum of costs> · parallel" over the checked agents that have an estimate. — covers: US-2 · verify: component — total text for two checked agents
- **AC-8** [ubiquitous] The Configure run screen shall label its run button "Select agents" and disable it when no agent is checked, "Run 1 agent" when one is, and "Run multi-agent review (N)" when N > 1 are. — covers: US-2 · verify: component — button text and disabled state for 0, 1 and 4 agents
- **AC-9** [event-driven] WHEN the reviewer clicks the run button, the Configure run screen shall send `POST /pulls/:id/multi-agent-run` for the selected pull request with the checked agent ids and open the results page of the returned run. — covers: US-2 · verify: component — mocked fetch URL and body, router push
- **AC-10** [state-driven] WHILE the start request is pending, the Configure run screen shall keep the run button disabled. — covers: US-2 · verify: component — a second click sends no second request
- **AC-11** [unwanted] IF the workspace has no agents, THEN the Configure run screen shall show "Enable agents to run reviews" with a "Go to Agents" link to `/agents`. — covers: US-2 · verify: component — empty state text and link target
- **AC-12** [ubiquitous] The API shall answer `GET /multi-agent-runs/estimates` with, for every agent of the workspace, the `duration_ms` and `cost_usd` of that agent's most recent `done` agent run, or `null` for both when it has none. — covers: US-2 · verify: integration — two agents, one with two done runs (newest values returned), one with none
- **AC-13** [event-driven] WHEN `POST /pulls/:id/multi-agent-run` is accepted, the API shall store one `multi_agent_runs` row and one `agent_runs` row per distinct agent id, enabled or not, each carrying the parent's id in `multi_agent_run_id`. — covers: US-1 · verify: integration — row counts and parent ids for a body with a duplicated id
- **AC-14** [event-driven] WHEN `POST /pulls/:id/multi-agent-run` is accepted, the API shall answer 200 with the `MultiAgentRun` holding one column per child in status `running` before any agent finishes. — covers: US-1 · verify: integration — response body with the mock model held
- **AC-15** [unwanted] IF the body of `POST /pulls/:id/multi-agent-run` has no `agent_ids` array of at least one string, THEN the API shall answer 422 and store no row. — covers: US-1 · verify: integration — empty array and missing field, row counts unchanged
- **AC-16** [unwanted] IF the pull request or any of the agent ids does not belong to the caller's workspace, THEN the API shall answer 404 and store no row. — covers: US-1 · verify: integration — unknown agent id among valid ones, row counts unchanged
- **AC-17** [ubiquitous] The API shall run the children of one multi-agent run at the same time, after loading the PR diff and resolving the intent once for all of them. — covers: US-1 · verify: integration — with the mock model held, every child reads `running` at once; the mock GitHub diff and the intent resolver are each called once
- **AC-18** [ubiquitous] The results page shall show in Columns mode one column per child, ordered by agent name, with the agent name, the status (`running`, `done`, `failed`, `cancelled`), duration · cost, the score, each finding's title and `file:line`, the finding count and a "View trace" link. — covers: US-3 · verify: component — a mocked run with three columns
- **AC-19** [ubiquitous] The results page shall show above the columns the PR number and title, the agent count, the longest child duration as total time and the summed cost. — covers: US-3 · verify: component — header text for a mocked run
- **AC-20** [state-driven] WHILE a child is `running`, the results page shall show its column as running and replace that status with the stored one when the child's `GET /runs/:id/events` stream ends, without a reload. — covers: US-3 · verify: component — mocked SSE `done` followed by a refetched run
- **AC-21** [unwanted] IF one child's model call fails, THEN the API shall store that child as `failed` with its error and finish the other children as `done` with their findings. — covers: US-3 · verify: integration — mock model throwing for one agent of three
- **AC-22** [unwanted] IF the PR diff cannot be loaded, THEN the API shall store every child of the run as `failed` with the load error. — covers: US-3 · verify: integration — mock GitHub failing the diff
- **AC-23** [unwanted] IF a child is `failed`, THEN the results page shall show its column with the status `failed` and the stored error while the other columns keep their findings. — covers: US-3 · verify: component — one failed and two done columns
- **AC-24** [unwanted] IF a column's agent has been deleted, THEN the results page shall label that column "Deleted agent". — covers: US-3 · verify: component — column with `agent_id: null`
- **AC-25** [event-driven] WHEN the reviewer switches to Tabs, the results page shall show one tab per child with its score, and for the selected one its summary, duration · cost, a "View trace" link and its findings. — covers: US-4 · verify: component — tab labels and the selected panel
- **AC-26** [event-driven] WHEN the reviewer expands a finding in Tabs mode, the results page shall show its confidence, rationale, suggested fix and the actions Accept, Dismiss, Learn and Turn into eval case. — covers: US-4 · verify: component — expanded card content and four buttons
- **AC-27** [event-driven] WHEN the reviewer clicks Accept or Dismiss on a finding, the results page shall send `POST /findings/:id/accept` or `/dismiss` and show the finding as accepted or dismissed. — covers: US-4 · verify: component — mocked request and the state tag
- **AC-28** [event-driven] WHEN the reviewer clicks Learn on a finding, the results page shall send `POST /findings/:id/learn` and show "Saved to memory". — covers: US-4 · verify: component — mocked request and the confirmation text
- **AC-29** [event-driven] WHEN `POST /findings/:id/learn` names a finding of the caller's workspace, the API shall store one `memory` row of kind `learning`, scope `repo`, holding the finding's title and rationale, without a model call. — covers: US-4 · verify: integration — memory row content, mock model call count unchanged
- **AC-30** [unwanted] IF `POST /findings/:id/learn` is repeated for the same finding, THEN the API shall answer 200 and store no second `memory` row. — covers: US-4 · verify: integration — two calls, one row
- **AC-31** [event-driven] WHEN the reviewer clicks Turn into eval case on a finding, the results page shall open the existing eval case modal prefilled from that finding. — covers: US-4 · verify: component — modal opens with the finding's file and lines
- **AC-32** [ubiquitous] The API shall put the findings of a multi-agent run's `done` children into one group when they share a file and their inclusive line ranges overlap, directly or through other findings of the group. — covers: US-5 · verify: unit — pure grouping over fixtures: overlap, touching ranges, chain of three, different files
- **AC-33** [ubiquitous] The API shall return for each group one take per `done` child, with its `run_id`, `agent_id`, `agent_name`, the ids of its findings in the group and their worst severity, or `ignored` when it has none there. — covers: US-5 · verify: unit — take list for a group raised by two of three agents, one with two findings
- **AC-34** [ubiquitous] The API shall title each group with the title of its finding of highest severity, then highest confidence, then first column, ranking a severity outside the contract below `SUGGESTION`. — covers: US-5 · verify: unit — tie-break fixtures including an unknown severity string
- **AC-35** [ubiquitous] The API shall return every stored finding of every child unchanged in that child's column, grouped or not. — covers: US-5 · verify: integration — column findings equal the stored findings of each child run
- **AC-36** [ubiquitous] The API shall mark a group `conflict: true` when at least one take is `ignored` or the flagged takes carry different severities. — covers: US-6 · verify: unit — agreement, did-not-flag and severity-split fixtures
- **AC-37** [ubiquitous] The results page shall show under "Where agents disagree" one row per group with its `file:line` and title and one cell per take naming the agent and its severity, or "did not flag". — covers: US-6 · verify: component — row and cells for a mocked group with an `ignored` take
- **AC-38** [event-driven] WHEN the reviewer turns on "Show only conflicts", the results page shall hide every group whose `conflict` is false. — covers: US-6 · verify: component — row count before and after the toggle
- **AC-39** [unwanted] IF fewer than two children are `done`, THEN the results page shall show "Needs at least two finished agents" in place of the disagreement rows. — covers: US-6 · verify: component — run with one done and one failed column
- **AC-40** [event-driven] WHEN the reviewer clicks "View trace" in a column or a tab, the results page shall open the PR page's run trace drawer for that child, with Configuration, Stats, Prompt assembly and "Copy raw output". — covers: US-7 · verify: component — drawer title names the agent; mocked `GET /runs/:id/trace` called with the child's run id
- **AC-41** [state-driven + event-driven] WHILE a child is `running`, WHEN the reviewer clicks its "View trace", the results page shall open the drawer on the Live log tab streaming that child's events. — covers: US-7 · verify: component — Live log tab active, SSE subscribed to the child's run id
- **AC-42** [ubiquitous] The API shall store in each child's run trace its tokens in and out, `cost_usd`, the grounding summary `k/n passed` and one log line per finding the grounding gate dropped with the reason. — covers: US-7 · verify: integration — trace of a child whose mock output cites a line outside the diff
- **AC-43** [event-driven] WHEN the reviewer opens Multi-Agent Review and the active repository has a multi-agent run, the Multi-Agent Review page shall show the results of the newest one. — covers: US-8 · verify: component — mocked latest run rendered as results
- **AC-44** [unwanted] IF the active repository has no multi-agent run, THEN the Multi-Agent Review page shall show the Configure run screen. — covers: US-8 · verify: component — mocked `run: null`
- **AC-45** [ubiquitous] The API shall answer `GET /repos/:id/multi-agent-runs/latest` with the multi-agent run of that repository with the newest `ran_at`, or `run: null` when there is none. — covers: US-8 · verify: integration — two runs on two PRs of one repo, one run on another repo
- **AC-46** [event-driven] WHEN the reviewer clicks "Start new review", the results page shall open the Configure run screen with the run's pull request and agents preselected. — covers: US-8 · verify: component — router push with `pr` and `agents` query values
- **AC-47** [event-driven] WHEN the reviewer reloads a results URL, the results page shall show the same run, read through `GET /multi-agent-runs/:id`. — covers: US-8 · verify: component — mocked fetch by the id in the route
- **AC-48** [unwanted] IF `GET /multi-agent-runs/:id` names no run of the caller's workspace, THEN the API shall answer 404. — covers: US-8 · verify: integration — unknown id and another workspace's id
- **AC-49** [ubiquitous] The sidebar shall show "Multi-Agent Review" in a GLOBAL section linking to `/repos/:repoId/multi-agent`, marked active on that path. — covers: US-8 · verify: component — extend `client/src/components/app-shell/navigation.test.tsx`
- **AC-50** [ubiquitous] The API shall store every finding of a child under a `reviews` row whose `agent_id` is the child's agent and whose `run_id` is the child's `agent_runs.id`. — covers: US-9 · verify: integration — join findings → reviews → agent_runs for a finished multi-agent run
- **AC-51** [ubiquitous] The API shall return `agent_id` and `run_id` as stored on every review of `GET /pulls/:id/reviews`. — covers: US-9 · verify: integration — reviews of a finished multi-agent run
- **AC-52** [event-driven] WHEN the same PR has been reviewed once by one agent and once by three agents, the measurement record shall hold each child's tokens in and out, cost and duration and each run's wall-clock time as read from `agent_runs`, with no scaling or rounding to a ratio. — covers: US-10 · verify: manual — needs a real model key and paid runs, which no agent starts; the user runs both and fills the record

## Edge cases

- **EC-1** The same agent id appears twice in `agent_ids` → one child for it. — covered by: AC-13
- **EC-2** A disabled agent is ticked → it runs like an enabled one, as the PR page allows today. — covered by: AC-13
- **EC-3** The API restarts mid-run → the boot reaper marks the running children `failed`; the page shows them failed. — covered by: AC-23
- **EC-4** A child is cancelled → its column shows `cancelled`, no finding of it enters a group. — covered by: AC-18
- **EC-5** One agent reports two findings on overlapping lines → one take listing both ids with the worse severity. — covered by: AC-33
- **EC-6** A stored severity is outside the contract (`findings.severity` is free text, server `INSIGHTS.md`) → ranked last. — covered by: AC-34
- **EC-7** Agent runs written before this feature, single runs from MCP, and CI runs (`multi_agent_run_id` null) → never part of a multi-agent run. — covered by: AC-32
- **EC-8** A second multi-agent run on the same PR → a new parent; the landing page shows the newer one; groups never mix runs. — covered by: AC-45
- **EC-9** Only one child finishes → no disagreement rows. — covered by: AC-39
- **EC-10** Learn clicked twice → one memory row. — covered by: AC-30
- **EC-11** The run trace is stored just after the run turns `done` (server `INSIGHTS.md`, `reviews-skills.it.test.ts` flake) → the drawer's trace query retries until it answers 200, as on the PR page. — covered by: AC-40

## Non-functional requirements

- **NFR-1** [cost] Opening the Multi-Agent Review page, the Configure run screen, the results page, the estimates and a trace makes no model call. — verify: integration — `agent_runs` / `run_traces` counts and mock model calls unchanged across the GET routes
- **NFR-2** [cost] A multi-agent run of N agents makes N review model calls and reuses one diff load and one intent resolution. — verify: integration — mock call counts for N = 3
- **NFR-3** [security] Every route this feature adds validates params and body with a Zod schema (422) and answers 404 for an entity of another workspace. — verify: integration — per route
- **NFR-4** [security] Finding text, PR title, agent name and description reach the screen as React text or through the existing Markdown component, never as raw HTML. — verify: component — a finding title `<img src=x onerror=alert(1)>` renders as text
- **NFR-5** [compatibility] `POST /pulls/:id/review`, `GET /pulls/:id/runs`, `GET /pulls/:id/runs/active` and `GET /pulls/:id/reviews` keep their response shapes for the MCP server and the PR page. — verify: integration — existing reviews suites; `mcp/` unit suite unchanged
- **NFR-6** [compatibility] `contracts/observability.ts`, `contracts/review-api.ts` and `contracts/platform.ts` change identically in `server/src/vendor/shared` and `client/src/vendor/shared`, and the client imports them as types only. — verify: `check-code.sh server` and `check-code.sh client` typecheck; the two observability files are byte-identical
- **NFR-7** [compatibility] The only schema change is a nullable `agent_runs.multi_agent_run_id` referencing `multi_agent_runs(id)` with `ON DELETE SET NULL`; existing rows keep `null`. — verify: integration — migration applies on a database holding earlier runs
- **NFR-8** [i18n] Every new visible string comes from `client/messages/en/runs.json` or `client/messages/en/prReview.json`. — verify: component — tests render through `NextIntlClientProvider` with those namespaces
- **NFR-9** [accessibility] Each agent checkbox is labelled with the agent's name, and the "Show only conflicts" toggle and the Columns / Tabs switch are buttons or inputs with an accessible name. — verify: component — queries by role and name

## Module interactions

Packages: server, client
Surfaces: PR page Run Review menu; Configure run screen, Multi-Agent Review results page and landing (`/repos/:repoId/multi-agent`, `/new`, `/:runId`); sidebar GLOBAL section; routes `POST /pulls/:id/multi-agent-run`, `GET /multi-agent-runs/:id`, `GET /repos/:id/multi-agent-runs/latest`, `GET /multi-agent-runs/estimates`, `POST /findings/:id/learn`

| # | From → To | Channel | Carries | Exists today | If it fails |
|---|---|---|---|---|---|
| MI-1 | client → server | POST /pulls/:id/multi-agent-run | `agent_ids` → `MultiAgentRun` | new | 422 / 404 / 429 toast on the PR page and Configure run; no run stored |
| MI-2 | server → server (multi-agent run → reviews executor) | in-process call into the review service | PR, agent rows, run ids, parent id | changes (server/src/modules/reviews/service.ts:122, run-executor.ts:121) | a child fails alone (AC-21); a diff failure fails all (AC-22) |
| MI-3 | server → model provider, GitHub | existing LLM and GitHub adapters | prompt per agent; one diff fetch | yes (server/src/modules/reviews/run-executor.ts:107) | child `failed` with the provider error |
| MI-4 | client → server | GET /runs/:id/events (SSE, replay first) | `RunEvent` per child | yes (server/src/modules/reviews/routes.ts:46) | column keeps `running` until the next refetch of MI-5 |
| MI-5 | client → server | GET /multi-agent-runs/:id | `MultiAgentRun` | new | error state with retry on the results page |
| MI-6 | client → server | GET /repos/:id/multi-agent-runs/latest | `run`: a `MultiAgentRun` or null | new | landing shows the Configure run screen with an error toast |
| MI-7 | client → server | GET /multi-agent-runs/estimates | `{ estimates: [...] }` | new | every agent shows "no estimate" |
| MI-8 | client → server | GET /runs/:id/trace | `RunTrace` (config, stats, prompt assembly, raw output, log) | yes (server/src/modules/reviews/routes.ts:120) | drawer shows its existing not-found state |
| MI-9 | client → server | POST /findings/:id/accept, /dismiss | `{ finding }` | yes (server/src/modules/reviews/routes.ts:141) | finding keeps its state, error toast |
| MI-10 | client → server | POST /findings/:id/learn | `{ finding }`; writes one `memory` row | changes (server/src/modules/reviews/findings.ts:36 answers 400 `invalid_action` today) | error toast, nothing stored |
| MI-11 | client → server | eval case modal (existing `EvalCaseAction`) | finding → prefilled case | yes (client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:113) | the modal's own error state |
| MI-12 | worktree B ingest → Postgres | `reviews.agent_id`, `reviews.run_id` | attribution of each CI finding | yes for local runs (server/src/modules/reviews/run-executor.ts:416-420); new for CI | — (contract below) |

```mermaid
sequenceDiagram
  participant UI as Configure run screen / PR page
  participant RES as Results page
  participant API as API
  participant GH as GitHub
  participant LLM as Model provider
  participant DB as Postgres
  UI->>API: POST /pulls/:id/multi-agent-run {agent_ids}
  API->>DB: insert parent + one running child per agent
  API-->>UI: MultiAgentRun (columns running)
  UI->>RES: open /multi-agent/:runId
  API->>GH: load diff once
  par one call per agent
    API->>LLM: review prompt
    LLM-->>API: findings
  end
  API->>DB: reviews, findings, trace per child
  RES->>API: GET /runs/:id/events per running child
  API-->>RES: events, then done
  RES->>API: GET /multi-agent-runs/:id
  API-->>RES: columns + groups
```

### Contracts (wire, snake_case — owned by worktree A, both vendor copies)

`POST /pulls/:id/multi-agent-run` — body `{ agent_ids: string[] }` (min 1; duplicates collapse). 200 → `MultiAgentRun`. 422 invalid body · 404 PR or an agent outside the workspace · 429 above 10 calls per minute (the limit `POST /pulls/:id/review` already uses, `server/src/modules/reviews/routes.ts:27`).

`GET /multi-agent-runs/:id` → `MultiAgentRun` · 404. `GET /repos/:id/multi-agent-runs/latest` → `{ run: MultiAgentRun | null }` · 404 repo outside the workspace. `GET /multi-agent-runs/estimates` → `{ estimates: { agent_id: string, duration_ms: int | null, cost_usd: number | null }[] }`. `POST /findings/:id/learn` → `{ finding: FindingRecord }` · 404.

`MultiAgentRun` in `contracts/observability.ts` — today declared and used by nothing (`grep MultiAgentRun` hits only the two contract files); reworked:

| Field | Type | Rule |
|---|---|---|
| `id`, `pr_id`, `ran_at` | string | as stored |
| `pr_number` | int \| null | |
| `pr_title` | string \| null | new |
| `agent_count` | int | number of children |
| `total_duration_ms` | int | longest `duration_ms` among children, 0 while none has one |
| `total_cost_usd` | number \| null | sum over children with a cost |
| `columns[]` | `AgentColumn` | one per child, ordered by agent name |
| `groups[]` | `FindingGroup` | replaces `conflicts`; built on read, never stored |

`AgentColumn`: existing fields, plus `status` gains `cancelled`, `agent_id` becomes nullable (agent deleted), new `error: string | null`, and `findings` becomes `FindingRecord[]` (the existing contract from `review-api.ts`, so confidence, rationale, suggestion and the accept / dismiss state reach the Tabs view). `AgentColumnFinding` is removed.

`FindingGroup`: `file`, `start_line`, `end_line` (span of the group), `title`, `conflict: boolean`, `takes: ConflictTake[]`. `ConflictTake`: `run_id`, `agent_id: string | null`, `agent_name` (replaces `persona`), `finding_ids: string[]`, `verdict: Severity | 'ignored'`, `note` (title of the take's worst finding, `""` when ignored).

**Finding attribution — the contract worktree B reads.** A finding is attributed through its review, never through a column of its own: `findings.review_id` → `reviews.agent_id` (the agent) and `reviews.run_id` (= `agent_runs.id`, the run that produced it); `agent_runs.source` says `local` or `ci`, and `agent_runs.multi_agent_run_id` is set only for children of a multi-agent run (null for CI runs). On the wire the same pair is `ReviewRecord.agent_id` / `ReviewRecord.run_id` (`contracts/review-api.ts`), `AgentColumn.agent_id` / `run_id` for the findings of a column, and `ConflictTake.agent_id` / `run_id` / `finding_ids`. Every writer — the local executor and B's CI ingest — sets both `agent_id` and `run_id` on each review it inserts. B reads these fields and changes none of them; a change to them is a new spec owned by A.

### Worktree boundaries

Worktree A (`feat/multi-agent-review`, `../devdigest-review`) owns: `server/src/modules/reviews/**`; the new multi-agent module `server/src/modules/multi-agent/**`; `server/src/db/schema/runs.ts` and the one new migration; `contracts/observability.ts`, `contracts/review-api.ts`, `contracts/platform.ts` in both vendor copies; `client/src/app/repos/[repoId]/pulls/[number]/**`; `client/src/app/repos/[repoId]/multi-agent/**`; `client/src/lib/hooks/reviews.ts` and a new multi-agent hooks file; `client/messages/en/runs.json`, `client/messages/en/prReview.json`; the run trace drawer wherever the plan places it for reuse.

Worktree A does not touch: `server/src/modules/ci/**`, `server/src/db/schema/ci.ts`, `contracts/eval-ci.ts`, `agent-runner/**`, the CI Runs page, the agent page's CI tab, `client/messages/en/ci.json`.

Shared files — both sides touch them, minimally:

- `client/src/vendor/ui/nav.ts` — A adds a `GLOBAL` group after `SKILLS LAB` holding one item `{ key: "multi-agent", href: "/repos/:repoId/multi-agent" }`; B, after updating from A, appends only `{ key: "ci-runs", … }` to that group. Neither edits other entries. `client/src/components/app-shell/helpers.ts` and `client/messages/en/shell.json` already map and label both keys and stay untouched.
- `client/src/components/app-shell/navigation.test.tsx` — each side appends its own `it(...)`; no edit to existing cases.
- `server/src/modules/index.ts` — each side adds one import and one entry for its module.
- `server/src/db/migrations/` (`meta/_journal.json`, snapshots) and `server/src/db/schema/runs.ts` — A's migration lands first; B regenerates any migration of its own after updating from A, never renumbers A's, and appends to `runs.ts` only if it needs an `agent_runs` column.

Merge order: A merges into `feature/lab-07` first (it carries the attribution contract and the nav group); B then updates from `feature/lab-07`, resolves only the shared files above, and repeats its checks. Before merging, `git -C ../devdigest-review diff --name-only` and `git -C ../devdigest-ci diff --name-only` intersect only in the shared files.

### Verification commands

Worktree A runs its own stack — API :3011, web :3010, database `devdigest_review` in the same `devdigest-postgres` container — so it shares neither a port nor a database with worktree B or the main checkout. No seed unless the user asks for one.

```bash
docker exec devdigest-postgres createdb -U devdigest devdigest_review
cd server && DATABASE_URL=postgres://devdigest:devdigest@localhost:5432/devdigest_review pnpm db:migrate
cd server && DATABASE_URL=postgres://devdigest:devdigest@localhost:5432/devdigest_review API_PORT=3011 WEB_PORT=3010 pnpm dev
cd client && NEXT_PUBLIC_API_BASE=http://localhost:3011 pnpm exec next dev -p 3010
.claude/agents/scripts/check-code.sh server
.claude/agents/scripts/check-code.sh --it server
.claude/agents/scripts/check-code.sh client
```

The 1-vs-3 measurement (AC-52) goes in `docs/multi-agent-measurement.md`: the same PR, one run with one agent and one with three, each child's tokens, cost and duration and each run's wall-clock (last child's `ran_at + duration_ms` minus the parent's `ran_at`), taken from `agent_runs` as stored.

## Design review

Sources reviewed: IN-1, IN-2, IN-3, IN-4, IN-5, IN-6, IN-7, IN-11, IN-12, IN-14

| # | Kind | Finding | Proposal | Decision |
|---|---|---|---|---|
| DR-1 | inconsistency | IN-1 calls the findings grouping heuristic (file, lines, gist similarity) ready; no such code exists in `server/src`, `reviewer-core/src` or `client/src` | build grouping on read by file and overlapping line ranges, no text similarity | accepted → AC-32 |
| DR-2 | inconsistency | IN-1 and IN-5 say the agents run in parallel; `executeRuns` awaits each agent in a `for` loop (`run-executor.ts:121`) | run the children concurrently after the shared diff and intent | accepted → AC-17 |
| DR-3 | module | the `multi_agent_runs` stub has no link to its children and `agent_runs` none to a parent (`server/src/db/schema/runs.ts`) | one nullable `agent_runs.multi_agent_run_id` column | accepted → AC-13 |
| DR-4 | inconsistency | IN-5 / IN-6 disagreement rows show Architecture, an agent not selected for the run | takes only for the run's own `done` children | accepted → AC-33 |
| DR-5 | missing state | IN-5 "did not flag" cells carry explanations ("Not a security concern") that nothing produces | show "did not flag" alone | accepted → AC-37 |
| DR-6 | missing state | IN-5 draws every column finished; running, failed and cancelled columns are not drawn | status per column, error on failure | accepted → AC-18 |
| DR-7 | missing state | no frame shows what Multi-Agent Review opens on when a run exists (IN-3 shows only the empty Configure run) | newest run of the repository, else Configure run | accepted → AC-43 |
| DR-8 | ux | IN-5 header says "fan-out via worktrees" — worktrees are how the lab is built, not how the product runs | say "parallel" | accepted → AC-19 |
| DR-9 | missing state | no frame shows the disagreement block with fewer than two finished agents | a one-line empty state | accepted → AC-39 |
| DR-10 | module | Learn is in the requirement and IN-6, but `actOnFinding` rejects `learn` with 400 (`server/src/modules/reviews/findings.ts:36`) | store one `learning` memory row per finding, no model call | accepted → AC-29 |
| DR-11 | ux | IN-6 shows "Reply to author" on a finding | leave out | rejected — not in the lab requirements (NG-5) |
| DR-12 | missing state | IN-4 shows an estimate for every agent; an agent that never ran has none | "no estimate", excluded from the total | accepted → AC-6 |
| DR-13 | inconsistency | IN-4 / IN-5 give each agent a colour and icon; the `agents` table has neither | one neutral icon | rejected — no data source (NG-8) |
| DR-14 | corner case | `POST /pulls/:id/review` parses its body by hand (`routes.ts:33`), against schema-first validation (`server/AGENTS.md`) | the new route declares a Zod body | accepted → AC-15 |
| DR-15 | ux | IN-6 replaces the design's "Configure run" button with nothing that starts a fresh run; IN-10 asks for "Start new review" | "Start new review" in that button's place and style | accepted → AC-46 |

## Inputs and provenance

| # | Source | Kind | Used for |
|---|---|---|---|
| IN-1 | course-materials/materials/lesson7/Lesson-07-lab/L07-lab-desccription.txt, Частина 1, 2, 4: «пікер агентів на сторінці PR і екран Configure run: вибір PR, чекбокси агентів, оцінка часу й вартості за минулими запусками та кнопка Run multi-agent review (N)»; «групування запусків через multi_agent_runs»; «групування знахідок на основі готової евристики без втрати оригіналів та атрибуції»; «блок Where agents disagree … зокрема did not flag, і перемикач Show only conflicts»; «Columns із живими статусами та Tabs + detail із confidence, suggested fix, Accept, Dismiss, Learn і Turn into eval case»; «кожна колонка має свій статус і посилання View trace»; «один збій не скасовує результати інших агентів»; «трейс дає пояснити токени, вартість і рішення grounding gate»; «фактичні цифри для «1 проти 3» записані. Не підганяйте висновок під очікувані 3×»; «Змержте worktree A, бо він додає атрибуцію, яку використовує ingest» | user text | Problem, G-1…G-6, US-1…US-7, US-9, US-10, NG-2, merge order |
| IN-2 | course-materials/materials/lesson7/Lesson-07-lab/img/img.png | figma export | AC-1…AC-3 |
| IN-3 | course-materials/materials/lesson7/Lesson-07-lab/img/img_1.png | figma export | AC-4, DR-7 |
| IN-4 | course-materials/materials/lesson7/Lesson-07-lab/img/img_2.png | figma export | AC-5…AC-8, DR-12, DR-13 |
| IN-5 | course-materials/materials/lesson7/Lesson-07-lab/img/img_3.png | figma export | AC-18, AC-19, AC-37, AC-38, DR-4…DR-6, DR-8 |
| IN-6 | course-materials/materials/lesson7/Lesson-07-lab/img/img_4.png | figma export | AC-25, AC-26, DR-11, DR-15 |
| IN-7 | docs/design/Dev Digest 2/Dev Digest/screen_multiagent.jsx | repository | AC-2, AC-7, AC-8 (button labels, longest-duration total) |
| IN-8 | task text, 2026-10-18: "keep the implementation simple — reuse what exists"; "each agent column must be able to open its logs/trace — reuse the existing run sidebar from the PR page"; "navigating to the Multi-Agent page must show the latest multi-agent run … with a 'Start new review' button"; boundaries, merge order, ports :3011 / :3010, DB `devdigest_review`, "prefer no new migration" | user text | US-8, NG-1, NG-9, AC-40, AC-43…AC-46, Worktree boundaries, Verification commands |
| IN-9 | task text, 2026-10-18: "The user delegated all decisions … choose the recommended (simplest) option yourself, write it into the spec as a decision" | user answer | every decision listed in the report's "Decisions taken" |
| IN-10 | course-materials/materials/lesson7/Lesson-07-lab/L07-lab-prompts.txt: «сайдбар перевикористати з того, який у нас використаний на pull request'ах»; «коли ми переходимо на Multi сторінку, у нас відображалися … останній запуск мультиагентів, і потім була кнопка …»; «Start New Review … як на дизайні» | user text | US-7, US-8, DR-15 |
| IN-11 | server/src/modules/reviews/routes.ts, service.ts, run-executor.ts, findings.ts @ 37642ab | code | MI-2…MI-4, MI-8…MI-10, DR-2, DR-10, DR-14, AC-21, AC-22 |
| IN-12 | server/src/db/schema/runs.ts, reviews.ts @ 37642ab | code | DR-3, AC-50, attribution contract |
| IN-13 | server/src/vendor/shared/contracts/observability.ts, review-api.ts, platform.ts (both copies) @ 37642ab | code | Contracts, NFR-6 |
| IN-14 | client PR page `_components/RunReviewDropdown`, `RunTraceDrawer`, `FindingCard`, `RunStatus`; client/src/vendor/ui/LiveLogStream.tsx, nav.ts; client/src/components/app-shell/helpers.ts @ 37642ab | code | AC-1, AC-26, AC-40, AC-41, AC-49, shared files |
| IN-15 | reviewer-core/src/grounding.ts:87, reviewer-core/src/review/run.ts:228 @ 37642ab | code | AC-42 |
| IN-16 | server/INSIGHTS.md (findings never deduplicated; severity is free text; trace saved after `done`), client/INSIGHTS.md (client imports shared contracts as types only) | repository | Problem, EC-6, EC-11, NFR-6 |
| IN-17 | mcp/src/api/http-client.ts @ 37642ab | code | NFR-5 |

| Items | Origin | Source |
|---|---|---|
| G-1…G-3, G-5, G-6, US-1…US-7, US-9, US-10, NG-2 | stated | IN-1 |
| G-4, US-8, NG-1, NG-9 | stated | IN-8 |
| NG-3…NG-8 | stated | IN-9 |
| AC-1…AC-3 | design | IN-2 |
| AC-4 | design | IN-3 |
| AC-5, AC-7, AC-8 | design | IN-4 |
| AC-6, AC-10, AC-11, AC-12 | stated | IN-9 |
| AC-9 | stated | IN-1 |
| AC-13…AC-16 | stated | IN-9 |
| AC-17 | stated | IN-1 |
| AC-18, AC-19 | design | IN-5 |
| AC-20, AC-21, AC-23 | stated | IN-1 |
| AC-22 | code | IN-11 |
| AC-24 | stated | IN-9 |
| AC-25, AC-26, AC-27 | design | IN-6 |
| AC-28…AC-30 | stated | IN-9 |
| AC-31 | code | IN-14 |
| AC-32…AC-36 | stated | IN-9 |
| AC-37, AC-38 | design | IN-5 |
| AC-39 | stated | IN-9 |
| AC-40, AC-41 | stated | IN-10 |
| AC-42 | code | IN-15 |
| AC-43, AC-44, AC-46 | stated | IN-8 |
| AC-45, AC-47, AC-48 | stated | IN-9 |
| AC-49 | design | IN-2 |
| AC-50, AC-51 | code | IN-12 |
| AC-52 | stated | IN-1 |
| EC-1…EC-5, EC-7…EC-10 | stated | IN-9 |
| EC-6, EC-11 | code | IN-16 |
| NFR-1…NFR-4, NFR-7…NFR-9 | stated | IN-9 |
| NFR-5 | code | IN-17 |
| NFR-6 | code | IN-16 |

## Untrusted inputs

| # | Input | Controlled by | Enters at | Reaches | Rule |
|---|---|---|---|---|---|
| UI-1 | `agent_ids` and `:id` params of the new routes | any HTTP caller | `POST /pulls/:id/multi-agent-run`, the new GET routes | SQL | Zod-validated, looked up only inside the caller's workspace, 404 otherwise — AC-15, AC-16, NFR-3 |
| UI-2 | finding title, rationale, suggestion (model output over PR content) | the PR author, through the model | stored findings | rendered HTML on the results page | rendered as text or through the existing Markdown component — NFR-4 |
| UI-3 | PR title | the PR author | GitHub import | rendered HTML in the results header and Configure run | rendered as React text — NFR-4 |
| UI-4 | finding title and rationale copied by Learn | the PR author, through the model | `POST /findings/:id/learn` | SQL (`memory` row) | parameterised insert, finding looked up inside the workspace; no prompt reads it — AC-29, NG-7 |
| UI-5 | agent name and description | a workspace user | agents table | rendered HTML in the picker, columns, tabs | rendered as React text — NFR-4 |

## Traceability

| Goal | Stories | Criteria | Edge cases | NFR |
|---|---|---|---|---|
| G-1 | US-1, US-2 | AC-1…AC-17 | EC-1, EC-2 | NFR-2, NFR-3 |
| G-2 | US-3, US-4, US-5, US-6 | AC-18…AC-39 | EC-3…EC-6, EC-9, EC-10 | NFR-4 |
| G-3 | US-7 | AC-40…AC-42 | EC-11 | — |
| G-4 | US-8 | AC-43…AC-49 | EC-8 | NFR-9 |
| G-5 | US-9 | AC-50, AC-51 | EC-7 | NFR-6, NFR-7 |
| G-6 | US-10 | AC-52 | — | — |
| — | — | — | — | NFR-1, NFR-5, NFR-8 |

## Open questions

None — every open decision was delegated by the user to the recommended option (IN-9) and is written into the section it changes.
