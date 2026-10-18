# Implementation Plan — Multi-Agent Review (SPEC-11)
Source: `specs/2026-10-18-multi-agent-review.md` · Base: `a8c0a3b` · Packages: server, client · Worktree: `/home/klov/emdash/repositories/devdigest-review` (branch `feat/multi-agent-review`)

## 0. Before the first edit
- **Precondition:** start every implementer with the worktree as its project root (see Questions, item 2). Every check command in this plan runs as `cd /home/klov/emdash/repositories/devdigest-review && CLAUDE_PROJECT_DIR=$PWD .claude/agents/scripts/check-code.sh <pkg>`.
- **Implementers write no tests in this run** (your decision). Moving an existing test with its component, and fixing a mock path in an existing test that the change breaks, is maintenance, not new tests.
- INSIGHTS that shape this plan:
  - `INSIGHTS.md § Tool & Library Notes` — "pnpm 12.4.2 exits non-zero with `ERR_PNPM_IGNORED_BUILDS`… AFTER doing the work" → judge `pnpm db:generate` by the files it wrote; fallback `cd server && ./node_modules/.bin/drizzle-kit generate`. Never answer `approve-builds`; revert any `pnpm-workspace.yaml` stub pnpm writes.
  - `INSIGHTS.md § What Doesn't Work` — "A per-brief filtered check stays green while parallel implementers break each other" → after both tracks land, the calling session runs `check-code.sh client` and `check-code.sh server` unfiltered (section 6).
  - `INSIGHTS.md § What Doesn't Work` — "An implementer's token bill is turns × standing context" → three briefs of two stages each. Batch the `Read first:` files in one message.
  - `INSIGHTS.md § What Doesn't Work` — "Proving absence with `git grep` passes vacuously for a new, still-untracked module" → presence and absence checks use `grep -rn`.
  - `INSIGHTS.md § Codebase Patterns` — "The starter pre-wires a course lesson" → already wired:
    - `client/messages/en/runs.json` `page.*`, `conflicts.*`, `column.*`, `viewTrace`
    - `client/messages/en/prReview.json` `finding.learn`
    - `client/src/components/app-shell/helpers.ts:28` (`/multi-agent` → `multi-agent`)
    - `client/messages/en/shell.json:26`

    Extend these files; add no second namespace.
  - `INSIGHTS.md § What Works` — "To prove a screen made no model call, diff `agent_runs` / `run_traces`" → this is the NFR-1 manual check.
  - `INSIGHTS.md § What Works` on dev-DB writes → the only DB written here is `devdigest_review`, never `devdigest`.
  - `server/INSIGHTS.md` — "Findings are never deduplicated", "One review row per AGENT RUN" → a column reads only its own child's review (by `run_id`), never "the latest review of the PR".
  - `server/INSIGHTS.md` — "`findings.severity` is a free-text column" → the group ranking puts an unknown severity below `SUGGESTION` (AC-34). A take's verdict carries the stored string, as `findingRowToDto` already does.
  - `server/INSIGHTS.md § Recurring Errors` — "`agent_runs.status` turns `done` BEFORE the run trace is stored" → EC-11: the drawer's trace query retries on 404 (Stage 5).
  - `server/INSIGHTS.md` — "A studio review is ONE LLM call" → cost and token numbers in the manual checks are one call per child.
  - `server/INSIGHTS.md § Tool & Library Notes` — "`tsx watch` does not restart the dev API when a file under `src/vendor/` changes" → restart `pnpm dev` on :3011 after Stage 1 before any manual check.
  - `client/INSIGHTS.md` — "`No QueryClient set`… the moment `FindingCard` renders a component that calls a TanStack hook" → moving `FindingCard` keeps every test that renders it transitively in the same stage.
  - `client/INSIGHTS.md` — "The client's vendored `@devdigest/shared` is a TYPE-only dependency" → client files use `import type` only. Severity values are a local tuple.
  - `client/INSIGHTS.md` — "`Tabs` renders plain `<button>`s" and "`MonoLink` renders a `<button>` when it is given no `href`" → the read-only `file:line` in columns is a `<span className="mono">`. The Columns/Tabs switch is real buttons (NFR-9).
  - `client/INSIGHTS.md § Recurring Errors` — "a CSS grid child has `min-width: auto`" → columns grid uses `minmax(0, 1fr)` tracks with `overflowWrap: "anywhere"` on paths.
  - `client/INSIGHTS.md § Tool & Library Notes` — "A bare ICU argument does not group digits" → counts and tokens in new messages use `{x, number}`.
  - `client/INSIGHTS.md § Recurring Errors` — "`next build` overwrote `client/.next` under the running `next dev`" → nobody runs `pnpm build` in `client/` while :3010 is up.
- Read: `specs/2026-10-18-multi-agent-review.md` (whole), its § Worktree boundaries, and `specs/2026-10-18-export-to-ci.md` § Ownership and merge order (lines 303-334). Also `server/AGENTS.md`, `client/AGENTS.md`, and `client/docs/findings-surfaces.md` (a new findings surface).

## 1. Scope — as the source states it
Goal:
- G-1 A reviewer starts a review of one PR by a chosen set of agents in one action, sees its time and cost estimate first, and the runs are stored as one multi-agent run. — `spec:21`
- G-2 A reviewer compares the agents of one multi-agent run: per-agent columns with live status, a tabbed detail view with finding actions, grouped findings with their authors, and where the agents disagree. — `spec:22`
- G-3 A reviewer opens the trace of each agent's run from the results and reads its tokens, cost and grounding gate decision there. — `spec:23`
- G-4 Opening Multi-Agent Review shows the newest multi-agent run of the repository, with a way to start a new one. — `spec:24`
- G-5 Export to CI (worktree B) relies on one written contract for which agent and which run produced a finding. — `spec:25`
- G-6 The cost and time of one agent against three agents on the same PR is recorded from measured numbers. — `spec:26`

(`spec` = `specs/2026-10-18-multi-agent-review.md`)

Non-goals:
- NG-1 A second review executor, trace drawer, log viewer or finding card — the existing `run-executor`, `RunTraceDrawer`, `LiveLogStream` and `FindingCard` are reused. — `spec:27`
- NG-2 Any change under `server/src/modules/ci/`, `agent-runner/`, the CI Runs page or the agent's CI tab. — `spec:28`
- NG-3 An explanation of why an agent did not flag a group; the cell reads "did not flag" only. — `spec:29`
- NG-4 A list of older multi-agent runs — only the newest one and a run opened by its URL are shown. — `spec:30`
- NG-5 "Reply to author" on a finding. — `spec:31`
- NG-6 Grouping by text similarity of findings; grouping uses file and line ranges only. — `spec:32`
- NG-7 Reading memory rows written by Learn into a prompt. — `spec:33`
- NG-8 Per-agent colours and icons; every agent uses one neutral icon. — `spec:34`
- NG-9 A new migration beyond one nullable column on `agent_runs`. — `spec:35`

Acceptance criteria (EARS sentence only; the `covers/verify` tails are cut):
- AC-1 WHEN the reviewer opens the Run Review menu, the PR page shall list every agent of the workspace with a checkbox, with the enabled agents checked. — `spec:63` — clear
- AC-2 The PR page shall label the menu's run button "Select agents" and disable it when no agent is checked, "Run 1 agent" when one is, and "Run multi-agent review (N)" when N > 1 are. — `spec:64` — clear
- AC-3 WHEN the reviewer clicks the menu's run button, the PR page shall send `POST /pulls/:id/multi-agent-run` with exactly the checked agent ids and open the results page of the returned run. — `spec:65` — clear
- AC-4 WHILE no pull request is selected, the Configure run screen shall show "Pick a pull request first" in place of the agent list and keep the run button disabled. — `spec:66` — clear
- AC-5 WHEN a pull request is selected, the Configure run screen shall list every agent of the workspace with a checkbox, its name, its description and its estimate as duration · cost. — `spec:67` — clear
- AC-6 IF an agent has no finished run, THEN the Configure run screen shall show "no estimate" for that agent and leave it out of the total. — `spec:68` — clear
- AC-7 WHILE at least one agent is checked, the Configure run screen shall show the total as "≈ <longest duration> · <sum of costs> · parallel" over the checked agents that have an estimate. — `spec:69` — clear
- AC-8 The Configure run screen shall label its run button "Select agents" and disable it when no agent is checked, "Run 1 agent" when one is, and "Run multi-agent review (N)" when N > 1 are. — `spec:70` — clear
- AC-9 WHEN the reviewer clicks the run button, the Configure run screen shall send `POST /pulls/:id/multi-agent-run` for the selected pull request with the checked agent ids and open the results page of the returned run. — `spec:71` — clear
- AC-10 WHILE the start request is pending, the Configure run screen shall keep the run button disabled. — `spec:72` — clear
- AC-11 IF the workspace has no agents, THEN the Configure run screen shall show "Enable agents to run reviews" with a "Go to Agents" link to `/agents`. — `spec:73` — clear (strings exist: `runs.json` `page.noAgents`)
- AC-12 The API shall answer `GET /multi-agent-runs/estimates` with, for every agent of the workspace, the `duration_ms` and `cost_usd` of that agent's most recent `done` agent run, or `null` for both when it has none. — `spec:74` — clear
- AC-13 WHEN `POST /pulls/:id/multi-agent-run` is accepted, the API shall store one `multi_agent_runs` row and one `agent_runs` row per distinct agent id, enabled or not, each carrying the parent's id in `multi_agent_run_id`. — `spec:75` — clear
- AC-14 WHEN `POST /pulls/:id/multi-agent-run` is accepted, the API shall answer 200 with the `MultiAgentRun` holding one column per child in status `running` before any agent finishes. — `spec:76` — clear
- AC-15 IF the body of `POST /pulls/:id/multi-agent-run` has no `agent_ids` array of at least one string, THEN the API shall answer 422 and store no row. — `spec:77` — clear
- AC-16 IF the pull request or any of the agent ids does not belong to the caller's workspace, THEN the API shall answer 404 and store no row. — `spec:78` — clear
- AC-17 The API shall run the children of one multi-agent run at the same time, after loading the PR diff and resolving the intent once for all of them. — `spec:79` — clear (diff and intent are already shared, `server/src/modules/reviews/run-executor.ts:105-120`; the loop at `:122` is sequential)
- AC-18 The results page shall show in Columns mode one column per child, ordered by agent name, with the agent name, the status (`running`, `done`, `failed`, `cancelled`), duration · cost, the score, each finding's title and `file:line`, the finding count and a "View trace" link. — `spec:80` — clear
- AC-19 The results page shall show above the columns the PR number and title, the agent count, the longest child duration as total time and the summed cost. — `spec:81` — clear
- AC-20 WHILE a child is `running`, the results page shall show its column as running and replace that status with the stored one when the child's `GET /runs/:id/events` stream ends, without a reload. — `spec:82` — clear
- AC-21 IF one child's model call fails, THEN the API shall store that child as `failed` with its error and finish the other children as `done` with their findings. — `spec:83` — already there per agent (`run-executor.ts:496-520`); stays true under `Promise.all` because each job catches its own error
- AC-22 IF the PR diff cannot be loaded, THEN the API shall store every child of the run as `failed` with the load error. — `spec:84` — already there (`run-executor.ts:84-114`)
- AC-23 IF a child is `failed`, THEN the results page shall show its column with the status `failed` and the stored error while the other columns keep their findings. — `spec:85` — clear
- AC-24 IF a column's agent has been deleted, THEN the results page shall label that column "Deleted agent". — `spec:86` — clear
- AC-25 WHEN the reviewer switches to Tabs, the results page shall show one tab per child with its score, and for the selected one its summary, duration · cost, a "View trace" link and its findings. — `spec:87` — clear
- AC-26 WHEN the reviewer expands a finding in Tabs mode, the results page shall show its confidence, rationale, suggested fix and the actions Accept, Dismiss, Learn and Turn into eval case. — `spec:88` — clear (`FindingCard` has all but Learn)
- AC-27 WHEN the reviewer clicks Accept or Dismiss on a finding, the results page shall send `POST /findings/:id/accept` or `/dismiss` and show the finding as accepted or dismissed. — `spec:89` — clear
- AC-28 WHEN the reviewer clicks Learn on a finding, the results page shall send `POST /findings/:id/learn` and show "Saved to memory". — `spec:90` — clear
- AC-29 WHEN `POST /findings/:id/learn` names a finding of the caller's workspace, the API shall store one `memory` row of kind `learning`, scope `repo`, holding the finding's title and rationale, without a model call. — `spec:91` — clear (today 400, `server/src/modules/reviews/findings.ts:31-33`)
- AC-30 IF `POST /findings/:id/learn` is repeated for the same finding, THEN the API shall answer 200 and store no second `memory` row. — `spec:92` — clear
- AC-31 WHEN the reviewer clicks Turn into eval case on a finding, the results page shall open the existing eval case modal prefilled from that finding. — `spec:93` — already there inside `FindingCard` (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:113`); reusing the card is enough
- AC-32 The API shall put the findings of a multi-agent run's `done` children into one group when they share a file and their inclusive line ranges overlap, directly or through other findings of the group. — `spec:94` — clear
- AC-33 The API shall return for each group one take per `done` child, with its `run_id`, `agent_id`, `agent_name`, the ids of its findings in the group and their worst severity, or `ignored` when it has none there. — `spec:95` — clear
- AC-34 The API shall title each group with the title of its finding of highest severity, then highest confidence, then first column, ranking a severity outside the contract below `SUGGESTION`. — `spec:96` — clear
- AC-35 The API shall return every stored finding of every child unchanged in that child's column, grouped or not. — `spec:97` — clear
- AC-36 The API shall mark a group `conflict: true` when at least one take is `ignored` or the flagged takes carry different severities. — `spec:98` — clear
- AC-37 The results page shall show under "Where agents disagree" one row per group with its `file:line` and title and one cell per take naming the agent and its severity, or "did not flag". — `spec:99` — clear
- AC-38 WHEN the reviewer turns on "Show only conflicts", the results page shall hide every group whose `conflict` is false. — `spec:100` — clear
- AC-39 IF fewer than two children are `done`, THEN the results page shall show "Needs at least two finished agents" in place of the disagreement rows. — `spec:101` — clear
- AC-40 WHEN the reviewer clicks "View trace" in a column or a tab, the results page shall open the PR page's run trace drawer for that child, with Configuration, Stats, Prompt assembly and "Copy raw output". — `spec:102` — clear (drawer exists; it moves so a second route can render it)
- AC-41 WHILE a child is `running`, WHEN the reviewer clicks its "View trace", the results page shall open the drawer on the Live log tab streaming that child's events. — `spec:103` — already there in the drawer (`RunTraceDrawer.tsx:41-46`, `running` prop); only wiring is new
- AC-42 The API shall store in each child's run trace its tokens in and out, `cost_usd`, the grounding summary `k/n passed` and one log line per finding the grounding gate dropped with the reason. — `spec:104` — already there (`run-executor.ts:454-490`; `reviewer-core/src/review/run.ts:228-232` emits `grounding dropped "<title>": <reason>` into the run log)
- AC-43 WHEN the reviewer opens Multi-Agent Review and the active repository has a multi-agent run, the Multi-Agent Review page shall show the results of the newest one. — `spec:105` — clear
- AC-44 IF the active repository has no multi-agent run, THEN the Multi-Agent Review page shall show the Configure run screen. — `spec:106` — clear
- AC-45 The API shall answer `GET /repos/:id/multi-agent-runs/latest` with the multi-agent run of that repository with the newest `ran_at`, or `run: null` when there is none. — `spec:107` — clear
- AC-46 WHEN the reviewer clicks "Start new review", the results page shall open the Configure run screen with the run's pull request and agents preselected. — `spec:108` — clear
- AC-47 WHEN the reviewer reloads a results URL, the results page shall show the same run, read through `GET /multi-agent-runs/:id`. — `spec:109` — clear
- AC-48 IF `GET /multi-agent-runs/:id` names no run of the caller's workspace, THEN the API shall answer 404. — `spec:110` — clear
- AC-49 The sidebar shall show "Multi-Agent Review" in a GLOBAL section linking to `/repos/:repoId/multi-agent`, marked active on that path. — `spec:111` — partly there (`app-shell/helpers.ts:28`, `shell.json:26`); the `nav.ts` group is missing
- AC-50 The API shall store every finding of a child under a `reviews` row whose `agent_id` is the child's agent and whose `run_id` is the child's `agent_runs.id`. — `spec:112` — already there (`run-executor.ts:416-427`)
- AC-51 The API shall return `agent_id` and `run_id` as stored on every review of `GET /pulls/:id/reviews`. — `spec:113` — already there (`server/src/modules/reviews/helpers.ts:23-37`, `service.ts:178-190`)
- AC-52 WHEN the same PR has been reviewed once by one agent and once by three agents, the measurement record shall hold each child's tokens in and out, cost and duration and each run's wall-clock time as read from `agent_runs`, with no scaling or rounding to a ratio. — `spec:114` — clear; manual, by the user (section 6)

Edge cases:
- EC-1 duplicated id → one child — `spec:118`
- EC-2 disabled agent runs like an enabled one — `spec:119`
- EC-3 boot reaper marks running children `failed` — `spec:120` — already there (`server/src/modules/reviews/repository/run.repo.ts` `reapStaleRunningRuns`)
- EC-4 cancelled child shows `cancelled`, enters no group — `spec:121`
- EC-5 two overlapping findings of one agent → one take, both ids, worse severity — `spec:122`
- EC-6 unknown severity ranked last — `spec:123`
- EC-7 runs with `multi_agent_run_id` null are never part of a multi-agent run — `spec:124`
- EC-8 a second run on the same PR → new parent; landing shows the newer; groups never mix runs — `spec:125`
- EC-9 only one child finishes → no disagreement rows — `spec:126`
- EC-10 Learn twice → one memory row — `spec:127`
- EC-11 trace stored just after `done` → "the drawer's trace query retries until it answers 200, as on the PR page" — `spec:128` — see section 7, note N1

Non-functional:
- NFR-1 [cost] Opening the Multi-Agent Review page, the Configure run screen, the results page, the estimates and a trace makes no model call. — `spec:132`
- NFR-2 [cost] A multi-agent run of N agents makes N review model calls and reuses one diff load and one intent resolution. — `spec:133`
- NFR-3 [security] Every route this feature adds validates params and body with a Zod schema (422) and answers 404 for an entity of another workspace. — `spec:134`
- NFR-4 [security] Finding text, PR title, agent name and description reach the screen as React text or through the existing Markdown component, never as raw HTML. — `spec:135`
- NFR-5 [compatibility] `POST /pulls/:id/review`, `GET /pulls/:id/runs`, `GET /pulls/:id/runs/active` and `GET /pulls/:id/reviews` keep their response shapes for the MCP server and the PR page. — `spec:136`
- NFR-6 [compatibility] `contracts/observability.ts`, `contracts/review-api.ts` and `contracts/platform.ts` change identically in `server/src/vendor/shared` and `client/src/vendor/shared`, and the client imports them as types only. — `spec:137` (this plan changes only `observability.ts`)
- NFR-7 [compatibility] The only schema change is a nullable `agent_runs.multi_agent_run_id` referencing `multi_agent_runs(id)` with `ON DELETE SET NULL`; existing rows keep `null`. — `spec:138`
- NFR-8 [i18n] Every new visible string comes from `client/messages/en/runs.json` or `client/messages/en/prReview.json`. — `spec:139`
- NFR-9 [accessibility] Each agent checkbox is labelled with the agent's name, and the "Show only conflicts" toggle and the Columns / Tabs switch are buttons or inputs with an accessible name. — `spec:140`

Contracts and boundaries: `spec:186-224` (§ Contracts, § Worktree boundaries) bind every stage as written.

## 2. Impact map
| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| server+client | `{server,client}/src/vendor/shared/contracts/observability.ts` | Modify | contracts (both copies) | AC-14, 18, 33, 45, 12, 15 |
| server | `server/src/db/schema/runs.ts` | Modify | schema | AC-13, NFR-7 |
| server | `server/src/db/migrations/0020_*.sql`, `meta/_journal.json`, `meta/0020_snapshot.json` | New (generated) | migration | NFR-7 |
| server | `server/src/modules/reviews/repository/run.repo.ts` | Modify | repository | AC-13, AC-12 |
| server | `server/src/modules/reviews/repository/review.repo.ts` | Modify | repository | AC-29, 30, 35 |
| server | `server/src/modules/reviews/repository.ts` | Modify | repository facade | AC-13, 29, 35 |
| server | `server/src/modules/reviews/service.ts` | Modify | service | AC-13, 16, 35 |
| server | `server/src/modules/reviews/run-executor.ts` | Modify | service internals | AC-17, 21 |
| server | `server/src/modules/reviews/findings.ts` | Modify | service internals | AC-29, 30 |
| server | `server/src/modules/reviews/routes.ts` | Modify | transport | AC-29 |
| server | `server/src/modules/multi-agent/{deps,constants,helpers,repository,service,routes}.ts` | New | module | AC-12–16, 32–36, 45, 48 |
| server | `server/src/modules/index.ts` | Modify (shared file: one import, one entry) | registry | all routes |
| client | `client/src/components/run-trace-drawer/**` (from `pulls/[number]/_components/RunTraceDrawer/**`) | New (moved) | cross-route tier | AC-40, 41 |
| client | `client/src/components/finding-card/**` (from `pulls/[number]/_components/FindingCard/**`) | New (moved) | cross-route tier | AC-26–28, 31 |
| client | `client/src/app/repos/[repoId]/pulls/[number]/{page.tsx,page.test.tsx}`, `_components/{FindingsPanel,DiffTab}/*.tsx` | Modify (imports only) | route | — |
| client | `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/**` | Modify | route-local | AC-1–3 |
| client | `client/src/lib/hooks/trace.ts` | Modify | hooks | EC-11 |
| client | `client/src/lib/hooks/multi-agent.ts` | New | hooks | AC-3, 9, 12, 43, 47 |
| client | `client/src/vendor/ui/nav.ts` | Modify (shared file: one group, one item) | design system nav | AC-49 |
| client | `client/src/app/repos/[repoId]/multi-agent/{page.tsx,new/page.tsx,[runId]/page.tsx}` | New | routes | AC-43, 44, 46, 47 |
| client | `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/**` | New | route-local | AC-4–11 |
| client | `client/src/app/repos/[repoId]/multi-agent/_components/MultiAgentResults/**` | New | route-local | AC-18–20, 23–28, 37–41, 46 |
| client | `client/messages/en/prReview.json`, `client/messages/en/runs.json` | Modify | i18n | NFR-8 |

Paths not touched: `server/src/modules/ci/**`, `server/src/db/schema/ci.ts`, `contracts/eval-ci.ts`, `contracts/trace.ts`, `agent-runner/**`, `client/src/app/ci-runs/**`, `client/src/app/agents/**`, `client/messages/en/ci.json`, `client/src/components/app-shell/helpers.ts`, `client/messages/en/shell.json`, `server/src/platform/container.ts`, `reviewer-core/**`, `mcp/**`.

## 3. Constraints in play
- dependency-cruiser (`server/.dependency-cruiser.cjs`) must stay green:
  - `no-cross-module-internals`: `multi-agent` never imports `reviews/repository*` or `reviews/helpers`. It reaches reviews through a consumer-declared port that `container.reviewService` satisfies structurally.
  - `no-service-to-container`: `multi-agent/service.ts` and `deps.ts` never import `platform/container.ts`.
  - `drizzle-only-in-repositories` and `schema-only-in-repositories`: Drizzle and `db/schema` appear only in `multi-agent/repository.ts` and `reviews/repository/*`.
  - `no-row-types-in-transport`: `routes.ts` never names `db/rows.ts`.
  - `no-circular`.
- Dual contract copy: one stage writes the server copy, then `cp` to the client copy; `diff -u` must print nothing.
- Migration: `cd server && pnpm db:generate` (fallback `./node_modules/.bin/drizzle-kit generate`) → `0020_<generated>.sql`. Never hand-written, never renamed. The implementer does not apply it (the guard refuses); the calling session applies it to `devdigest_review` only.
- Naming: module files kebab-case; wire JSON snake_case; React component folders PascalCase with `index.ts`; cross-route components in `client/src/components/<kebab-case>/` (`run-trace-drawer`, `finding-card`); message keys camelCase.
- `container.ts` is not edited. Both `B` and `A` would need it. `MultiAgentService` is built in its `routes.ts` from `app.container`, as `reviews/routes.ts:22` does.
- Shared files keep the minimal touch from `spec:217-222`:
  - `server/src/modules/index.ts`: one import, one entry.
  - `client/src/vendor/ui/nav.ts`: one `GLOBAL` group after `SKILLS LAB` with the one `multi-agent` item.
  - `navigation.test.tsx` is NOT touched in this run (no tests).
- pnpm 12: on `ERR_PNPM_IGNORED_BUILDS`, check the result and do not answer `approve-builds`. Restore any `server/pnpm-workspace.yaml` / `client/pnpm-workspace.yaml` that pnpm rewrote to its base content (`git diff` must show none).
- **Cut as over-engineering** — none of these is built:
  - Zod response schemas on the new routes (reviews routes have none; NFR-3 asks params and body only).
  - A `multiAgentService` container getter.
  - Stored groups (`groups` are built on read, `spec:203`).
  - An index on `multi_agent_run_id` (NG-9; see REC3).
  - A second SSE helper (the existing `useRunEvents` is reused per running column).
  - A separate header component.
  - A polling fallback (REC1).
  - Deleting the now-unused client `useRunReview` hook.
  - Changes to `review-api.ts` / `platform.ts`. Every new schema goes in `observability.ts`.

## 4. Stages

### Stage 1 — Multi-agent contracts in both vendor copies
Track: shared · After: —
Files: `server/src/vendor/shared/contracts/observability.ts`, `client/src/vendor/shared/contracts/observability.ts`
Read first: `server/src/vendor/shared/contracts/observability.ts:1-86` (the shapes to rework), `server/src/vendor/shared/contracts/review-api.ts:1-60` (`FindingRecord`), `server/src/vendor/shared/contracts/findings.ts:1-30` (`Severity`)
Steps:
1. In the server copy, import `FindingRecord` from `./review-api.js`. Delete `AgentColumnFinding` and `Conflict`.
2. `AgentColumn`: keep the fields, but set:
   - `agent_id: z.string().nullable()`
   - `status: z.enum(['running','done','failed','cancelled'])`
   - add `error: z.string().nullable()`
   - `findings: z.array(FindingRecord)`
3. `ConflictTake`:
   - `run_id: z.string()`
   - `agent_id: z.string().nullable()`
   - `agent_name: z.string()` (replaces `persona`)
   - `finding_ids: z.array(z.string())`
   - `verdict: z.union([Severity, z.literal('ignored')])`
   - `note: z.string()`
4. New `FindingGroup`:
   - `file: z.string()`, `start_line: z.number().int()`, `end_line: z.number().int()`
   - `title: z.string()`, `conflict: z.boolean()`
   - `takes: z.array(ConflictTake)`
5. `MultiAgentRun`:
   - `id`, `pr_id`, `ran_at` (string)
   - `pr_number: z.number().int().nullable()`
   - `pr_title: z.string().nullable()`
   - `agent_count`, `total_duration_ms` (int)
   - `total_cost_usd: z.number().nullable()`
   - `columns: z.array(AgentColumn)`, `groups: z.array(FindingGroup)` (replaces `conflicts`)
6. New request/response schemas, each with its same-named type:
   - `MultiAgentRunRequest = z.object({ agent_ids: z.array(z.string().uuid()).min(1) })`
   - `MultiAgentRunLatest = z.object({ run: MultiAgentRun.nullable() })`
   - `MultiAgentEstimate = z.object({ agent_id: z.string(), duration_ms: z.number().int().nullable(), cost_usd: z.number().nullable() })`
   - `MultiAgentEstimates = z.object({ estimates: z.array(MultiAgentEstimate) })`
7. Update the file header comment's list of shapes. Then `cp server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts`.
Skills: `zod` → `.claude/skills/zod/references/object-optional-vs-nullable.md` — nullable for "known absent" wire fields; `onion-architecture` → `rules/zod-contracts.md` § Both copies must change, § Naming and casing — PascalCase schema plus same-named type, snake_case wire.
Tests to add: none in this run. Later test-writer: none at this stage (covered through the route suites).
Done when: `diff -u server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts` prints nothing; `grep -rn "AgentColumnFinding" server/src client/src` prints nothing; `check-code.sh --no-tests server` and `check-code.sh --no-tests client` are green.

### Stage 2 — `agent_runs.multi_agent_run_id` and its migration
Track: shared · After: 1
Files: `server/src/db/schema/runs.ts`, `server/src/db/migrations/0020_*.sql` (generated), `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0020_snapshot.json` (generated)
Read first: `server/src/db/schema/runs.ts:1-52`, `server/src/db/migrations/0019_skill_evals.sql` (the generated style), `ls server/src/db/migrations/meta`
Steps:
1. Move the `multiAgentRuns` table declaration above `agentRuns` in `runs.ts`; it stays unchanged. This gives a plain forward reference with no TS circularity.
2. Add to `agentRuns`: `multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' })`, nullable, with a one-line doc comment ("set only for children of a multi-agent run; null for single, MCP and CI runs").
3. `cd server && pnpm db:generate`. On `ERR_PNPM_IGNORED_BUILDS` before generation, run `./node_modules/.bin/drizzle-kit generate`. Keep the generated name.
4. Read the SQL. It must hold only `ALTER TABLE "agent_runs" ADD COLUMN "multi_agent_run_id" uuid` plus one `ADD CONSTRAINT … FOREIGN KEY … REFERENCES "multi_agent_runs"("id") ON DELETE set null`. Any other statement means the snapshot was out of sync: stop and report it under "Not done", do not edit the file.
5. Run generate again. It must answer `No schema changes, nothing to migrate`.
6. Do NOT run `pnpm db:migrate`. The calling session applies it (Questions, item 1).
Skills: `drizzle-orm-patterns` → `references/migrations.md` — generated migrations only; `postgresql-table-design` → `SKILL.md` — nullable FK with explicit `ON DELETE` (index left out per NG-9, REC3); `onion-architecture` → `rules/drizzle-persistence.md` § Migrations.
Tests to add: none in this run. Later test-writer: NFR-7 (the migration applies on a DB holding earlier runs; covered by every `.it` suite migrating its container).
Done when: exactly one new `server/src/db/migrations/0020_*.sql` with the two statements above; the second generate prints "No schema changes"; `check-code.sh server` is green; `git diff --name-only -- server/pnpm-workspace.yaml` prints nothing.

### Stage 3 — Reviews module: child runs, concurrency, Learn, reviews by run
Track: server · After: 2
Files: `server/src/modules/reviews/{service,run-executor,findings,routes,repository}.ts`, `server/src/modules/reviews/repository/{run.repo,review.repo}.ts`
Read first: `server/src/modules/reviews/service.ts:36-148`, `server/src/modules/reviews/run-executor.ts:61-160`, `server/src/modules/reviews/findings.ts`, `server/src/modules/reviews/routes.ts:17-22,139-148`, `server/src/modules/reviews/repository.ts:1-177`, `server/src/modules/reviews/repository/run.repo.ts:118-145`, `server/src/modules/reviews/repository/review.repo.ts:1-117`, `server/src/db/schema/knowledge.ts:21-42` (`memory`)
Steps:
1. `run.repo.ts` `createAgentRun`: accept `multiAgentRunId?: string | null` and write it. `ReviewRepository.createAgentRun` passes it through.
2. `service.ts`:
   - `RunTargets` gains `agentIds?: string[]` and `multiAgentRunId?: string`.
   - `resolveTargets` checks `agentIds` first. It de-duplicates (EC-1) and calls `agents.getById(workspaceId, id)` per id. The first miss throws `NotFoundError('Agent not found')`. It does not filter by `enabled` (EC-2).
   - `runReview` passes `multiAgentRunId: opts.multiAgentRunId ?? null` into each `createAgentRun`.
   - The existing `agentId` / `all` branches and the response shape stay byte-for-byte the same (NFR-5).
3. `run-executor.ts` `executeRuns`: replace the `for (const { agent, runId } of jobs)` loop (`:122-159`) with `await Promise.all(jobs.map(async ({ agent, runId }) => { … }))`. The body is unchanged; its try/catch already isolates each job (AC-21). The shared diff and intent above stay as they are (AC-17, NFR-2).
4. Learn:
   - `review.repo.ts`: new `saveLearningOnce(db, { workspaceId, repoId, findingId, content })`. It selects from `t.memory` where `workspaceId`, `kind = 'learning'` and ``sql`${t.memory.sources}->>'finding_id' = ${findingId}` `` (limit 1). When nothing is found it inserts `{ workspaceId, repoId, scope: 'repo', kind: 'learning', content, sources: { finding_id: findingId } }`. Parameterised only (UI-4).
   - Expose it on `ReviewRepository`.
   - `findings.ts`: add `case 'learn'`. Call `repo.saveLearningOnce({ workspaceId, repoId: ctx.pull.repoId, findingId, content: `${ctx.finding.title}\n\n${ctx.finding.rationale}` })`, then return `{ finding: findingRowToDto(ctx.finding) }`. No model call (AC-29, AC-30).
   - `routes.ts`: `FINDING_ACTIONS = ['accept', 'dismiss', 'learn'] as const`. Update the header comment line.
5. Reviews by run:
   - `review.repo.ts`: new `reviewsForRuns(db, workspaceId, runIds)` selects reviews where `workspaceId` and `inArray(t.reviews.runId, runIds)`, each with its findings (same shape as `reviewsForPull`). An empty `runIds` returns `[]` without a query.
   - `ReviewRepository.reviewsForRuns`.
   - `ReviewService.reviewsForRuns(workspaceId, runIds): Promise<ReviewDto[]>` maps with `reviewToDto(review, findings, null)`. It is the read the multi-agent module uses (AC-35).
Skills:
- `onion-architecture` → `rules/layers.md` § Module shape (use cases stay in the service, queries in `repository/`); `rules/drizzle-persistence.md` § Row types do not cross the repository boundary (the service returns `ReviewDto`, never rows).
- `drizzle-orm-patterns` → `references/queries-joins-aggregations.md` — `inArray`, a jsonb `->>` predicate through `sql`.
- `fastify-best-practices` → `rules/routes.md` — the action route keeps `IdParams` schema-first.
- `security` → `SKILL.md` — finding text (model output over PR content) is stored through a parameterised insert only.
Tests to add: none in this run. Later test-writer:
- AC-13 (child rows carry the parent id, duplicate collapses), AC-17 / NFR-2 (with the model held, all children `running` at once; diff and intent once), AC-21, AC-22 — `server/test/multi-agent.it.test.ts`
- AC-29, AC-30 — `server/test/findings-learn.it.test.ts`
- NFR-5 — the existing `server/test/reviews*.it.test.ts`
Done when: `check-code.sh server` is green (typecheck, depcruise, unit lane).

### Stage 4 — `multi-agent` module: start, read, latest, estimates, grouping
Track: server · After: 3
Files: `server/src/modules/multi-agent/{deps,constants,helpers,repository,service,routes}.ts` (all New), `server/src/modules/index.ts`
Read first: `server/src/modules/reviews/deps.ts:1-30,95-107` (consumer-declared port pattern), `server/src/modules/reviews/routes.ts:1-45` (route, rate limit, `getContext`), `server/src/modules/reviews/repository/run.repo.ts:1-70` (agent_runs + agents join, row → plain object), `server/src/modules/pulls/findings-summary.ts:20-40` (unknown-severity ordering to mirror, not import), `server/src/modules/_shared/schemas.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts:290-300` (`reviewService` getter the port binds to)
Steps:
1. `deps.ts`:
   - Port `MultiAgentReviews`:
     - `runReview(workspaceId: string, prId: string, opts: { agentIds: string[]; multiAgentRunId: string }): Promise<unknown>`
     - `reviewsForRuns(workspaceId: string, runIds: string[]): Promise<{ run_id: string | null; verdict: string | null; summary: string | null; findings: FindingRecord[] }[]>`
   - `MultiAgentDeps { readonly db: Db; readonly reviewService: MultiAgentReviews }`.
   - No import of `reviews/*` or `platform/container.ts`.
2. `constants.ts`:
   - `SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 }`; anything else ranks 0.
   - `START_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }` (`spec:188`).
3. `repository.ts` (`MultiAgentRepository`, Drizzle only here; returns plain objects, no row types):
   - `pullInWorkspace(workspaceId, prId) → { id } | undefined`
   - `countAgents(workspaceId, ids) → number`
   - `repoInWorkspace(workspaceId, repoId) → boolean`
   - `insertRun(workspaceId, prId) → id`
   - `getRunHead(workspaceId, id) → { id, prId, ranAt, prNumber, prTitle } | undefined`: `multi_agent_runs` joined to `pull_requests`, scoped by `multi_agent_runs.workspace_id`.
   - `children(runId) → { runId, agentId, agentName, provider, model, status, error, durationMs, costUsd, score }[]`: `agent_runs` left-joined to `agents` where `multi_agent_run_id = runId`.
   - `latestRunId(workspaceId, repoId) → string | null`: join `pull_requests` on `repo_id`, `ORDER BY multi_agent_runs.ran_at DESC LIMIT 1` (AC-45, EC-8).
   - `estimates(workspaceId) → { agentId, durationMs, costUsd }[]`: every agent of the workspace, left-joined to the newest `status = 'done'` `agent_runs` row per agent (`selectDistinctOn([agentRuns.agentId])` ordered by `agentId, ranAt desc`). Null for both when there is none (AC-12).
4. `helpers.ts` (pure, no I/O):
   - `groupFindings(columns: AgentColumn[]): FindingGroup[]`:
     - It considers only columns with `status === 'done'` (EC-4, EC-7 by construction).
     - It sweeps per `file` by `start_line`. A finding joins the current group when `start_line <= group.end_line` (inclusive ranges, chains through the group: AC-32). Group span is min start / max end.
     - Takes: one per done column, in column order. `finding_ids` lists that column's findings in the group, `verdict` is their worst severity by `SEVERITY_RANK` (the stored string, cast as `findingRowToDto` casts), `note` is the title of that worst finding (AC-33, EC-5). When the column has none in the group: `verdict: 'ignored'`, `finding_ids: []`, `note: ''`.
     - `title`: the finding with highest rank, then highest `confidence`, then earliest column (AC-34, EC-6).
     - `conflict = takes.some(ignored) || new Set(flagged verdicts).size > 1` (AC-36).
     - Groups are ordered by file, then start line.
   - `buildMultiAgentRun(head, children, reviews): MultiAgentRun`:
     - Columns: one per child, sorted by agent name with deleted agents (null name) last.
     - Column fields: `agent_name: name ?? ''`, `status` from the row (`running` | `done` | `failed` | `cancelled`; null → `running`), `error`, `score`, `duration_ms`, `cost_usd`, `provider`, `model`, and `verdict` / `summary` / `findings` from the child's review matched by `run_id`, with `findings` unchanged (AC-35); `[]` when there is no review.
     - `agent_count = children.length`.
     - `total_duration_ms` = max non-null `duration_ms`, else 0.
     - `total_cost_usd` = sum of non-null costs, `null` when none.
     - `groups = groupFindings(columns)`, plus `pr_number`, `pr_title`, and `ran_at` as an ISO string.
5. `service.ts` (`MultiAgentService`, constructor `(deps: MultiAgentDeps)`, builds `new MultiAgentRepository(deps.db)` as `ReviewService` does):
   - `start(workspaceId, prId, agentIds)`:
     - De-duplicate the ids.
     - Return 404 when `pullInWorkspace` misses or `countAgents !== ids.length`, before any insert (AC-16).
     - `insertRun`, then `reviewService.runReview(workspaceId, prId, { agentIds: ids, multiAgentRunId })` (creates `running` children and fires the executor), then return `get(workspaceId, id)` (AC-13, AC-14).
   - `get(workspaceId, id)`: `getRunHead` (404 `NotFoundError('Multi-agent run not found')`, AC-48), `children`, `reviewService.reviewsForRuns(workspaceId, childIds)`, then `buildMultiAgentRun`.
   - `latest(workspaceId, repoId)`: `repoInWorkspace` (404) → `latestRunId` → `{ run: id ? await get(…) : null }`.
   - `estimates(workspaceId)` → `{ estimates: [...] }` in snake_case.
6. `routes.ts`, default export plugin with `withTypeProvider<ZodTypeProvider>()` and `const service = new MultiAgentService(app.container)`:
   - `POST /pulls/:id/multi-agent-run` — `{ schema: { params: IdParams, body: MultiAgentRunRequest }, config: { rateLimit: START_RATE_LIMIT } }` (AC-15 422 by schema, 429)
   - `GET /multi-agent-runs/estimates`
   - `GET /multi-agent-runs/:id` — `IdParams`
   - `GET /repos/:id/multi-agent-runs/latest` — `IdParams`

   Every handler: `getContext` → service → return. No logic in the route.
7. `server/src/modules/index.ts`: one import `import multiAgent from './multi-agent/routes.js';` and one entry `multiAgent,`. Nothing else.
Skills:
- `onion-architecture` → `rules/ports-and-di.md` § A port is defined by the consumer, § Inject ports, not the container; `rules/fastify-transport.md` § A route does exactly four things, § Validation is declarative; `rules/layers.md` § Cross-module rules.
- `fastify-best-practices` → `rules/schemas.md`, `rules/routes.md` — route-level Zod body and params, per-route rate limit.
- `zod` → `references/parse-validate-early.md`.
- `drizzle-orm-patterns` → `references/queries-joins-aggregations.md` — left join, `selectDistinctOn`, order and limit.
- `security` → `SKILL.md` — workspace scoping on every read, 404 for foreign ids (NFR-3, UI-1).
Tests to add: none in this run. Later test-writer:
- AC-32–AC-34, AC-36, EC-5, EC-6 — unit `server/test/multi-agent-grouping.test.ts` over `groupFindings`
- AC-12, AC-14–AC-16, AC-35, AC-45, AC-48, AC-50, AC-51, NFR-1, NFR-3 — `server/test/multi-agent.it.test.ts`
- AC-42 — trace of a child whose mock output cites a line outside the diff
Done when: `check-code.sh server` is green; `grep -rn "platform/container\|reviews/repository\|reviews/helpers" server/src/modules/multi-agent` prints nothing.

### Stage 5 — Client foundation: shared drawer and card, Learn, nav, hooks, PR-page picker
Track: client · After: 1
Files:
- `client/src/components/run-trace-drawer/**` (moved from `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**`)
- `client/src/components/finding-card/**` (moved from `…/_components/FindingCard/**`)
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `page.test.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/{RunReviewDropdown.tsx,RunReviewDropdown.test.tsx,styles.ts,constants.ts}`
- `client/src/lib/hooks/trace.ts`, `client/src/lib/hooks/multi-agent.ts` (New)
- `client/src/vendor/ui/nav.ts`
- `client/messages/en/prReview.json`

Read first: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx`, its `RunReviewDropdown.test.tsx`, `…/_components/FindingCard/FindingCard.tsx`, `…/_components/RunTraceDrawer/RunTraceDrawer.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/page.test.tsx:40-70`, `client/src/lib/hooks/reviews.ts:136-180` (mutation and invalidation pattern), `client/src/lib/hooks/trace.ts`, `client/src/vendor/ui/nav.ts`, `client/src/vendor/ui/kit/Checkbox.tsx`, `client/src/lib/api.ts:1-80` (`ApiError.status`), `docs/design/Dev Digest 2/Dev Digest/screen_multiagent.jsx` (picker labels)
Steps:
1. Move `RunTraceDrawer/` → `client/src/components/run-trace-drawer/` with `mv`.
   - Keep file names; internal relative imports survive the move.
   - Fix only the depth of `messages/en/*.json` and `vi.mock` paths in the moved `RunTraceDrawer.test.tsx`.
   - `page.tsx` imports `RunTraceDrawer from "@/components/run-trace-drawer"`; `page.test.tsx:56` mocks `"@/components/run-trace-drawer"`.
2. Move `FindingCard/` (with `_components/EvalCaseAction`) → `client/src/components/finding-card/`.
   - `FindingsPanel.tsx` and `DiffTab.tsx` import `{ FindingCard } from "@/components/finding-card"`.
   - Fix import depths in the moved `FindingCard.test.tsx` and `EvalCaseAction.test.tsx`.
   - Afterwards, `grep -rn "_components/FindingCard\|_components/RunTraceDrawer" client/src` must print nothing.
3. `FindingCard`: add optional props `onLearn?: () => void` and `learned?: boolean`.
   - The Learn button (`t("finding.learn")`, icon `Brain`) renders only when `onLearn` is given. The PR page passes none, so it does not change there.
   - When `learned` is set it shows `t("finding.savedToMemory")` and the button is disabled.
   - Add `"savedToMemory": "Saved to memory"` under `finding` in `prReview.json`.
4. `useRunTrace` (EC-11, MI-8): replace `retry: false` with `retry: (count, err) => err instanceof ApiError && err.status === 404 && count < 10` and `retryDelay: 1000`. The drawer's not-found state stays reachable after about 10 s (section 7, N1).
5. `nav.ts`: append after the `SKILLS LAB` group: `{ section: "GLOBAL", items: [{ key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent" }] }`. No other entry changes.
6. `client/src/lib/hooks/multi-agent.ts` (type-only imports from `@devdigest/shared`):
   - `multiAgentRunKey(id)` → `["multi-agent-run", id]`
   - `useMultiAgentRun(id)` → `GET /multi-agent-runs/${id}`
   - `useLatestMultiAgentRun(repoId)` → `GET /repos/${repoId}/multi-agent-runs/latest`
   - `useMultiAgentEstimates()` → `GET /multi-agent-runs/estimates`
   - `useStartMultiAgentRun()` → mutation `POST /pulls/${prId}/multi-agent-run` with `{ agent_ids }`; on success `setQueryData(multiAgentRunKey(run.id), run)`.
   - REC1 (accepted): `useMultiAgentRun` sets `refetchInterval: (q) => q.state.data?.columns.some(c => c.status === 'running') ? 4000 : false`, next to the per-child SSE refetch.
7. `RunReviewDropdown`:
   - Replace the `Dropdown` (it closes on every item click) with a local popover. The trigger is the existing `Button` and toggles `open`. A panel (styles in `styles.ts`, width `DROPDOWN_WIDTH`) holds:
     - the merged warning row as today;
     - one `Checkbox` per agent of `useAgents()`, `label` = the agent name (NFR-9), with model / "disabled" as a muted hint;
     - the run button;
     - "Configure agents…" → `/agents`;
     - "No agents yet — create one" when the list is empty.
   - The selection is initialised once from the enabled agents when the list first loads (AC-1).
   - Run-button label from `prReview.runReview.selectAgents` (disabled) / `runOne` / `runMany` with `{count, number}` (AC-2). It is disabled while pending.
   - Click: `onRunStart?.()`, then `mutateAsync({ prId, agentIds: [...checked] })`, then `onRunsStarted?.(run.columns.map(c => c.run_id))`, then `router.push(`/repos/${repoId}/multi-agent/${run.id}`)` with `repoId` from `useParams` (AC-3); `onRunSettled?.()` in `finally`.
   - Add the three keys to `prReview.json` `runReview`: "Select agents", "Run 1 agent", "Run multi-agent review ({count, number})".
   - In the existing smoke test only, change the `vi.mock` to `@/lib/hooks/multi-agent` (`useStartMultiAgentRun`) and mock `next/navigation`'s `useParams`, so the test still renders without a `QueryClient`. Add no case.
Skills:
- `frontend-ui-architecture` → `placement.md` § The ladder, § Components — rendered by two routes → `components/<kebab>/`.
- `react-best-practices` → `SKILL.md` — derived state for labels, no effect for the initial selection beyond a one-time init.
- `react-testing-library` → `SKILL.md` — moved tests keep their queries; only paths change.
Tests to add: none in this run. Later test-writer:
- AC-1–AC-3 — `RunReviewDropdown.test.tsx`
- AC-28 UI half — `components/finding-card/FindingCard.test.tsx`
- AC-49 — append one `it` to `client/src/components/app-shell/navigation.test.tsx`
- NFR-9 picker part
Done when: `check-code.sh client` is green (the whole client suite, so the moved tests and `FindingsPanel` / `DiffTab` / `page` suites run); the grep in step 2 prints nothing.

### Stage 6 — Multi-Agent Review pages: landing, Configure run, results
Track: client · After: 5
Files:
- `client/src/app/repos/[repoId]/multi-agent/page.tsx`, `new/page.tsx`, `[runId]/page.tsx`
- `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/{ConfigureRun.tsx,helpers.ts,styles.ts,index.ts}`
- `client/src/app/repos/[repoId]/multi-agent/_components/MultiAgentResults/{MultiAgentResults.tsx,helpers.ts,styles.ts,index.ts}`
- `…/MultiAgentResults/_components/{AgentColumns,AgentTabs,Disagreements,ChildRunWatcher}/{<Name>.tsx,index.ts}` (one `styles.ts` each only where it earns the file)
- `client/messages/en/runs.json`

Read first: `client/src/app/repos/[repoId]/conventions/page.tsx` (thin route plus Suspense), `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:1-80` (AppShell, `useActiveRepo`, `usePulls` id resolution, `?trace` handling), `client/src/components/run-trace-drawer/RunTraceDrawer.tsx` (props), `client/src/components/finding-card/FindingCard.tsx` (props after Stage 5), `client/src/lib/hooks/reviews.ts:160-245` (`useFindingAction`, `useRunEvents`), `client/src/components/run-cost/helpers.ts` (`formatUsd`), `client/messages/en/runs.json`, `docs/design/Dev Digest 2/Dev Digest/screen_multiagent.jsx`
Steps:
1. Routes, each thin with a `<Suspense>` around a client component that uses `useSearchParams`:
   - `multi-agent/page.tsx`: `useLatestMultiAgentRun(repoId)`. Loading → `Skeleton`. `run` → `<MultiAgentResults run={…} repoId=…/>` (AC-43). `run: null` or an error → `<ConfigureRun repoId=…/>`, with `notify.error` on error (AC-44, MI-6).
   - `new/page.tsx` → `<ConfigureRun repoId preselect={{ pr: search.get("pr"), agents: search.get("agents")?.split(",") }} />`.
   - `[runId]/page.tsx` → `useMultiAgentRun(runId)`. On error, `ErrorState` with `onRetry={refetch}` (MI-5); otherwise `<MultiAgentResults/>` (AC-47).
   - All three render inside `AppShell` as the PR page does.
2. `ConfigureRun`:
   - PR select over `usePulls(repoId)`. Options read `t("page.prItem", { number, title })` as React text (NFR-4).
   - With no PR, show `multiAgent.pickPrFirst` in place of the list, and the run button stays disabled (AC-4).
   - Agent rows: `Checkbox` labelled with the name, the description, and the estimate from `useMultiAgentEstimates` as `formatDuration(ms) · formatUsd(cost)`, or `multiAgent.noEstimate` (AC-5, AC-6).
   - Initial checks: the `agents` query, else the enabled agents.
   - Total: `multiAgent.total` = "≈ {duration} · {cost} · parallel" over checked agents with an estimate: max duration, sum of costs (AC-7). Hidden when nothing is checked.
   - Run button: labels `multiAgent.runButton.{select,one,many}` (AC-8). Disabled while `isPending` (AC-10).
   - Click → `useStartMultiAgentRun` for the selected PR id → `router.push(`/repos/${repoId}/multi-agent/${run.id}`)` (AC-9).
   - No agents → `EmptyState` with `page.noAgents.title` and a `Link` to `/agents` labelled `page.noAgents.cta` (AC-11).
   - `helpers.ts`: `formatDuration`, `estimateTotal(checked, estimates)`.
3. `MultiAgentResults({ run, repoId })`:
   - Header: `#{pr_number} · {pr_title}`, and `page.meta`, rewritten to "{count, number} agents · parallel · {duration} total · {cost}" (DR-8), from `agent_count`, `total_duration_ms` and `total_cost_usd` (AC-19).
   - "Start new review" button → `router.push(`/repos/${repoId}/multi-agent/new?pr=${run.pr_id}&agents=${ids}`)`, where `ids` are the columns' non-null `agent_id`s (AC-46).
   - Columns / Tabs switch: two `Button`s with text names (NFR-9).
   - Drawer state `{ runId, agentName, running, findings }` → `<RunTraceDrawer … prNumber={run.pr_number} onClose/>` (AC-40, AC-41).
   - One `<ChildRunWatcher runId onSettled={() => qc.invalidateQueries({ queryKey: multiAgentRunKey(run.id) })}/>` per `running` column. It calls `useRunEvents([runId])` and fires `onSettled` once when `running` flips true → false. It renders nothing (AC-20).
   - Finding actions: `useFindingAction().mutateAsync({ findingId, action })`, then invalidate `multiAgentRunKey(run.id)` (AC-27). Learn: action `learn`, then add the id to a local `learned` set, passed to `FindingCard` (AC-28).
4. `AgentColumns`:
   - Grid with `gridTemplateColumns: repeat(n, minmax(0, 1fr))`.
   - Per column: agent name, or `multiAgent.deletedAgent` when `agent_id` is null (AC-24); a status label for `running` | `done` | `failed` | `cancelled`; `duration · cost`; score; finding count (`column.findingsCount`); each finding's title and `<span className="mono">file:line</span>` (AC-18); the stored `error` when `failed` (AC-23); `viewTrace` button.
5. `AgentTabs`:
   - One tab button per column, labelled with the name and score.
   - Selected panel: `summary` (or `tabs.noSummary`), `duration · cost`, `viewTrace`, and `FindingCard` per finding with `onAction` and `onLearn` (AC-25, AC-26, AC-31).
6. `Disagreements`:
   - Title `conflicts.title`.
   - Toggle "Show only conflicts" as a `Checkbox` labelled `conflicts.onlyConflicts`, which filters `conflict === false` out (AC-38).
   - One row per group: `file:start_line-end_line` and title; one cell per take with the agent name and a `SeverityBadge`, or `conflicts.didNotFlag` (AC-37). NG-3: no explanation.
   - Fewer than two `done` columns → `multiAgent.needsTwoAgents` "Needs at least two finished agents" (AC-39). Zero groups → `conflicts.empty`.
7. `runs.json`: add `multiAgent.{pickPrFirst, noEstimate, total, runButton.{select,one,many}, deletedAgent, needsTwoAgents, startNewReview, status.{running,done,failed,cancelled}}` and rewrite `page.meta`. ICU numbers use `{x, number}`. All finding, PR and agent text renders as React text or through the card's existing `Markdown` (NFR-4).
Skills:
- `next-best-practices` → `file-conventions.md`, `suspense-boundaries.md` — thin `page.tsx`, a client boundary for `useSearchParams`.
- `react-best-practices` → `SKILL.md` — derived totals, no fetch in components.
- `frontend-ui-architecture` → `placement.md` § Sub-component ownership (pieces only `MultiAgentResults` renders live in its `_components/`; `ConfigureRun` and `MultiAgentResults` sit at `multi-agent/_components/`, the nearest common parent of the three pages) and `logic.md` (server data only through `lib/hooks`).
Tests to add: none in this run. Later test-writer:
- AC-4–AC-11 — `ConfigureRun.test.tsx`
- AC-18–AC-20, AC-23–AC-28, AC-31, AC-37–AC-41, AC-46 — `MultiAgentResults.test.tsx` and its sub-components
- AC-43, AC-44, AC-47 — page tests
- NFR-4 — a `<img onerror>` finding title renders as text
- NFR-8, NFR-9
Done when: `check-code.sh client` is green; `grep -rn "fan-out via p-queue" client/messages` prints nothing.

## 5. Skills matrix
| Stage | onion-architecture | fastify-best-practices | drizzle-orm-patterns | postgresql-table-design | zod | security | react-best-practices | next-best-practices | frontend-ui-architecture | react-testing-library |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `rules/zod-contracts.md` | | | | `references/object-optional-vs-nullable.md` | | | | | |
| 2 | `rules/drizzle-persistence.md` § Migrations | | `references/migrations.md` | `SKILL.md` | | | | | | |
| 3 | `rules/layers.md`, `rules/drizzle-persistence.md` | `rules/routes.md` | `references/queries-joins-aggregations.md` | | | `SKILL.md` | | | | |
| 4 | `rules/ports-and-di.md`, `rules/fastify-transport.md`, `rules/layers.md` | `rules/schemas.md`, `rules/routes.md` | `references/queries-joins-aggregations.md` | | `references/parse-validate-early.md` | `SKILL.md` | | | | |
| 5 | | | | | | | `SKILL.md` | | `placement.md` | `SKILL.md` (moved tests) |
| 6 | | | | | | | `SKILL.md` | `file-conventions.md`, `suspense-boundaries.md` | `placement.md`, `logic.md` | |

## 6. Verification
| Package | Command (from the worktree root, prefixed `CLAUDE_PROJECT_DIR=$PWD`) | Proves |
|---|---|---|
| shared | `diff -u server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts` | NFR-6: copies byte-identical |
| shared | `grep -rn "AgentColumnFinding" server/src client/src` (empty) | old contract gone (prints its two definitions at base `a8c0a3b`) |
| server | `.claude/agents/scripts/check-code.sh server` | typecheck, depcruise (layering rules in section 3), unit lane — Stages 2–4 |
| server | `.claude/agents/scripts/check-code.sh --it server` (Docker; calling session after the join) | existing reviews suites unchanged — NFR-5, NFR-7 (every `.it` suite migrates its own container through `0020`) |
| client | `.claude/agents/scripts/check-code.sh client` (unfiltered, calling session after the join) | typecheck plus the whole suite, incl. moved drawer and card tests and `FindingsPanel` / `DiffTab` / `page` |
| server | `ls server/src/db/migrations/ \| tail -3` and read `0020_*.sql` | NFR-7, NG-9: one nullable column plus FK `ON DELETE SET NULL` only |
| server (calling session) | `cd server && DATABASE_URL=postgres://devdigest:devdigest@localhost:5432/devdigest_review pnpm db:migrate` | migration applied to `devdigest_review` only, never `devdigest` |
| boundary | `git -C /home/klov/emdash/repositories/devdigest-review status --porcelain` lists nothing under `server/src/modules/ci/`, `agent-runner/`, `client/src/app/ci-runs/`, `client/src/app/agents/`, `contracts/eval-ci.ts`, `contracts/trace.ts`, `client/messages/en/ci.json`, `reviewer-core/`, `mcp/` | NG-2, `spec:213-224` |
| manual (calling session, API :3011, web :3010, DB `devdigest_review`, `pnpm dev` restarted after Stage 1) | PR page menu: checkboxes, labels, run → `/repos/:repoId/multi-agent/:runId`; columns live, then refetched; Tabs and card actions; Learn twice → one `memory` row (`select count(*) from memory where kind='learning'`); "View trace" running and done; sidebar GLOBAL item; landing shows newest; "Start new review" preselects; reload a results URL | AC-1–AC-11, AC-18–AC-31, AC-37–AC-47, AC-49 (needs a model key for real children; with no key a child fails → AC-21 / AC-23 path) |
| manual | snapshot `select count(*) from agent_runs` and `from run_traces` on `devdigest_review`, open landing, Configure run, a results URL, estimates and a trace, snapshot again | NFR-1: counts unchanged |
| manual (user) | `docs/multi-agent-measurement.md`: per child `select r.id, a.name, r.tokens_in, r.tokens_out, r.cost_usd, r.duration_ms, r.ran_at from agent_runs r left join agents a on a.id=r.agent_id where r.multi_agent_run_id = '<id>'`; wall-clock = max(`ran_at + duration_ms`) − parent `ran_at` | AC-52 — paid runs, no agent starts them |
| later (test-writer, not scheduled) | the files named under each stage's "Tests to add" | AC-1–AC-51, EC-1–EC-11, NFR-1–NFR-9 as listed per stage |

## 7. Risks and open questions
- [non-blocking] Who applies migration `0020` to `devdigest_review`? The guard blocks implementers; the default is the calling session after Brief 1 (Questions, item 1).
- [non-blocking] Implementers must run with the worktree as project root, else `implementer-guard` refuses their writes and `check-code.sh` checks the main checkout (Questions, item 2).
- [non-blocking] N1 — EC-11 says the trace query "retries … as on the PR page", but the PR page's `useRunTrace` has `retry: false` today (`client/src/lib/hooks/trace.ts:17`). The plan builds the behaviour the EC states: a bounded retry on 404 (about 10 s), so MI-8's not-found state stays reachable. Because the drawer is shared, the PR page gains the same retry.
- [non-blocking] `agent_ids` items are validated as uuids, so a non-uuid string answers 422 rather than 404. A non-uuid would otherwise reach a `uuid` column and fail with 500. A random uuid outside the workspace answers 404 (AC-16).
- [non-blocking] Replacing the executor loop with `Promise.all` also makes the legacy `POST /pulls/:id/review {all:true}` run its agents in parallel. The response shape is unchanged (NFR-5), and the PR page no longer calls that branch.
- [non-blocking] A take whose worst finding has an out-of-contract severity carries that stored string as `verdict`. The same holds for `FindingRecord.severity` today. No route declares a response schema, so nothing rejects it; the client falls back to `SEV_COLOR_FALLBACK`.
- [non-blocking] `start` inserts the parent before `runReview` creates the children. An agent deleted between the two checks leaves a parent with zero children (`agent_count: 0`). There is no transaction on purpose (simplest).
- [non-blocking] Worktree B appends `ci-runs` to the `GLOBAL` group and one entry to `modules/index.ts` after A merges (`spec:219-224`). A merges first.

## 8. Handoff to reviewers
- Architecture:
  - New consumer-declared port `MultiAgentReviews` (`server/src/modules/multi-agent/deps.ts`), satisfied structurally by `container.reviewService`. The service is built in `multi-agent/routes.ts` from `app.container`, and `container.ts` is untouched.
  - `MultiAgentRepository` writes only `multi_agent_runs`. It reads `agent_runs`, `agents`, `pull_requests` and `repos` through joins, as `reviews/repository/run.repo.ts` already reads `agents`. Child `agent_runs` rows are written only by the reviews module.
  - Findings reach the module through `ReviewService.reviewsForRuns`, never a second mapper.
  - The pure grouping lives in `multi-agent/helpers.ts`.
  - Two components move to `client/src/components/{run-trace-drawer,finding-card}/` because a second route renders them.
- Security:
  - Four new routes, all `getContext`-scoped, with Zod params and body. `POST /pulls/:id/multi-agent-run` is rate-limited at 10/min.
  - 404 on a foreign PR, agent, repo or run.
  - `POST /findings/:id/learn` copies model output (title, rationale) into `memory` through a parameterised insert. No prompt reads it (NG-7).
  - Results render finding, PR and agent text as React text or through the existing `Markdown`. No `dangerouslySetInnerHTML`.

## 9. Execution
Mode: multi-agent — stated in the task ("Execution mode: multi-agent, at most 3 implementer agents in total").
Recommended: multi-agent. After the shared contract and schema stage, the server and client tracks have disjoint write sets and each holds two real stages.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| shared | 1–2 | `server/src/vendor/shared/contracts/observability.ts`, `client/src/vendor/shared/contracts/observability.ts`, `server/src/db/schema/runs.ts`, `server/src/db/migrations/**` | — | alone |
| server | 3–4 | `server/src/modules/reviews/**`, `server/src/modules/multi-agent/**`, `server/src/modules/index.ts` | shared | parallel |
| client | 5–6 | `client/src/components/run-trace-drawer/**`, `client/src/components/finding-card/**`, `client/src/app/repos/[repoId]/pulls/[number]/**`, `client/src/app/repos/[repoId]/multi-agent/**`, `client/src/lib/hooks/trace.ts`, `client/src/lib/hooks/multi-agent.ts`, `client/src/vendor/ui/nav.ts`, `client/messages/en/prReview.json`, `client/messages/en/runs.json` | shared | parallel |
| join | — (calling session) | applies `0020` to `devdigest_review`; runs `check-code.sh --it server` and `check-code.sh client` unfiltered; manual checks; then plan-verifier → architecture-reviewer, fix loop of at most 2 rounds / 2 fix subagents | server, client | alone |

Briefs — three implementers in total, one per brief, each a fresh `implementer`:
- shared · stages 1–2 → "Execute stages 1–2 of specs/2026-10-18-multi-agent-review-plan.md (track shared) in /home/klov/emdash/repositories/devdigest-review. Write only inside: server/src/vendor/shared/contracts/observability.ts, client/src/vendor/shared/contracts/observability.ts, server/src/db/schema/runs.ts, server/src/db/migrations/** (generated by drizzle-kit only). Do not run db:migrate. Write no tests. Check with: CLAUDE_PROJECT_DIR=$PWD .claude/agents/scripts/check-code.sh server client --no-tests, then check-code.sh server."
- server · stages 3–4 (after shared) → "Execute stages 3–4 of specs/2026-10-18-multi-agent-review-plan.md (track server) in /home/klov/emdash/repositories/devdigest-review. Write only inside: server/src/modules/reviews/**, server/src/modules/multi-agent/**, server/src/modules/index.ts (one import, one entry). Write no tests. Check with: CLAUDE_PROJECT_DIR=$PWD .claude/agents/scripts/check-code.sh server."
- client · stages 5–6 (after shared, parallel to server) → "Execute stages 5–6 of specs/2026-10-18-multi-agent-review-plan.md (track client) in /home/klov/emdash/repositories/devdigest-review. Write only inside: the client write set in section 9. Move existing tests with their components and fix only their paths; write no new tests. Never run pnpm build. Check with: CLAUDE_PROJECT_DIR=$PWD .claude/agents/scripts/check-code.sh client."

single-agent: the same three briefs one after another; the Runs column is not used.

## 10. Recommendations — decided by the calling session (user delegated)
REC1 accepted (Stage 5 step 6). REC2 accepted (spec EC-11 wording fixed). REC3 declined: NG-9 / NFR-7 stay as written, no index.

### Original list
- REC1 [approach] Add `refetchInterval: 4000` to `useMultiAgentRun` while any column is `running`, next to the per-child SSE refetch. Why: MI-4's failure row ("column keeps running until the next refetch of MI-5") assumes a later refetch. With SSE alone, a dropped stream leaves a column `running` until a reload. `usePrRuns` already polls this way (`client/src/lib/hooks/reviews.ts:44-52`). Would change: one line in Stage 5, step 6.
- REC2 [requirements] Correct EC-11's wording in a later spec revision ("retries until it answers 200", without "as on the PR page"). Why: `client/src/lib/hooks/trace.ts:17` has `retry: false`; the plan builds the stated behaviour and the PR page inherits it. Would change: no stage, only the spec text.
- REC3 [requirements] Add an index on `agent_runs(multi_agent_run_id)` in the same migration. Why: every results read and every SSE-triggered refetch filters children by that column. `postgresql-table-design` indexes FK columns used in lookups; NG-9 ("beyond one nullable column") rules it out today. Would change: Stage 2 (one `index(...)` in `runs.ts`, one more generated statement), and NG-9 / NFR-7 in the spec.
