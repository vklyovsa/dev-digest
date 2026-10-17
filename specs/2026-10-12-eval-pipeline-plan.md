# Implementation Plan — Eval Pipeline (SPEC-03)
Source: `specs/2026-10-12-eval-pipeline.md` (Status: approved; `check-spec.sh` ok, 2 WARN, 0 FAIL) · Base: `1d4e77f` · Packages: server, client (contracts in both `vendor/shared` copies). `reviewer-core/` is not modified — confirmed in §3.

## 0. Before the first edit

- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "An implementer's token bill is turns × standing context" → 13 briefs of one stage each (one of two); every stage has `Read first`.
- INSIGHTS: `INSIGHTS.md § What Works` — "Any write to the dev DB goes through a dry run on a restored copy in the SAME container" and "Before a seed or migration on the dev DB, list what the user has changed" → stages 16 and 17.
- INSIGHTS: `INSIGHTS.md § What Works` — "To prove a screen made no model call, diff `agent_runs` / `run_traces`" → stage 17 step 3.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "Proving absence with `git grep` passes vacuously for a new, still-untracked module" and "A plan's absence check on generic words can never print nothing" → every absence check here is `grep -rn` on identifiers only the removed code had.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "pr-self-review runs no drizzle/postgres lane on a table edit" → stage 2 names `drizzle-orm-patterns` and `postgresql-table-design` deliberately.
- INSIGHTS: `INSIGHTS.md § Codebase Patterns` — "The starter pre-wires a course lesson on both sides" → reserved pieces are extended, not duplicated (§1 "already there").
- INSIGHTS: `INSIGHTS.md § Codebase Patterns` — "A consumer-declared structural port is what actually breaks a module/composition-root cycle" → `modules/eval/types.ts` declares its own ports.
- INSIGHTS: `INSIGHTS.md § Codebase Patterns` — "Run cost is already plumbed end-to-end" → the run sums `ReviewOutcome.costUsd`; no second pricing path.
- INSIGHTS: `INSIGHTS.md § Recurring Errors` — "API (and web) drop … when an agent session started the stack" → stage 17 starts it with `setsid nohup`.
- INSIGHTS: `INSIGHTS.md § Recurring Errors` — "`psql -U postgres` … role does not exist" and "the table is `repos`" → stages 16 and 17 use `-U devdigest -d devdigest`.
- INSIGHTS: `INSIGHTS.md § Tool & Library Notes` — "A long subagent result reaches the calling session cut and HTML-escaped" → this plan is saved by script from the transcript.
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes` — "`drizzle-kit generate` becomes INTERACTIVE the moment one migration both drops and adds columns" → stage 3 is hand-written with snapshot and journal, proved by "No schema changes".
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes` — "`tsx watch` does not restart the dev API when a file under `src/vendor/` changes" → stage 17 starts the stack after the build.
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes` — "`deepseek/deepseek-v4-flash` spends completion tokens before it writes" → the eval run sends no `maxTokens`, as a live review does; expect slow cases in stage 17.
- INSIGHTS: `server/INSIGHTS.md § Recurring Errors` — "the `/tmp` tsconfig recipe needs `typeRoots`, and it is the calling session that runs it" → stage 15.
- INSIGHTS: `server/INSIGHTS.md § Recurring Errors` — "`statusCode` does not exist on type `void & Promise<Response> & Chain`" → inject helpers type the payload as `Record<string, unknown>`.
- INSIGHTS: `server/INSIGHTS.md § Recurring Errors` — "A new table gets a column called `created_at` when you meant `started_at`" → `now()` is used only for `eval_cases.created_at`.
- INSIGHTS: `server/INSIGHTS.md § Recurring Errors` — "`agent_runs.status` turns `done` BEFORE the run trace is stored" → eval tests wait on the eval run's own row, written in one update.
- INSIGHTS: `server/INSIGHTS.md § Codebase Patterns` — "Findings are never deduplicated between runs", "`findings.severity` is a free-text column", "A stored PR holds its first 100 files only", "A studio review is ONE LLM call", "`wrapUntrusted` closes a block against the exact string" → EC-3, EC-31, EC-5, NFR-2, NG-11 respectively; none is fixed here.
- INSIGHTS: `server/INSIGHTS.md § Codebase Patterns` — "A derived count belongs on the DTO … filled on EVERY read path" → `last_result` is set on every path that returns a case.
- INSIGHTS: `server/INSIGHTS.md § What Doesn't Work` — "the hermetic lane is hermetic now" → the boot reaper of stage 7 is wrapped non-fatal like the existing one, so `routes-smoke.test.ts` stays green.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors` — "The client's vendored `@devdigest/shared` is a TYPE-only dependency" → `import type` only; build check on a copy in stage 15.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors` — "The PR page renders blank … after `pnpm build` in `client/`" → never build in the live `client/`.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors` — "A vitest hook that RETURNS a function gets that function called as teardown" → block bodies in mock-resetting hooks.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "`Tabs` renders plain `<button>`s; a Modal inside a Drawer gives two dialogs", "`user-event` is not a dependency", "`client/` typecheck DOES cover `*.test.tsx`", "A vitest path filter under a dynamic segment silently matches nothing", "A name-fragment filter also matches DIRECTORY names", "A bare ICU argument does not group digits", "`MonoLink` renders a `<button>` without `href`", "`Chip` always renders a `<button>`" → test and component rules in stages 9–13.
- INSIGHTS: `client/INSIGHTS.md § Codebase Patterns` — "`[number]/_components/` is flat … a new component goes under the single parent that renders it" → `EvalCaseAction` sits inside `FindingCard/_components/`.
- INSIGHTS: `reviewer-core/INSIGHTS.md`, `e2e/INSIGHTS.md` — not read: neither package is touched.
- Read: `specs/2026-10-12-eval-pipeline.md`; `server/AGENTS.md`, `client/AGENTS.md`; `client/docs/findings-surfaces.md` (stage 10); `server/docs/prompt-logging.md` (stage 7); `TESTING.md § Conventions`.

## 1. Scope — as the source states it

Goal (`specs/2026-10-12-eval-pipeline.md:33-39`):
- G-1 "A reviewer turns an accepted or a dismissed finding into an eval case of the agent that produced it with one click"
- G-2 "An agent author sees every eval case of an agent's set in the agent editor and removes one created by mistake"
- G-3 "runs the agent on all cases of its set as one eval run whose inputs are frozen"
- G-4 "Each eval run reports recall, precision and citation accuracy computed in code, with no model call in the scoring and no model call on any read"
- G-5 "opens the run history of an agent and compares two runs side by side"
- G-6 "A page in the left sidebar, Eval Dashboard, shows every agent's latest eval run and the most recent eval runs across agents"
- G-7 "a set of at least 8 cases with both expectation types runs and scores as one run, and one command reports whether the feature's checks are green"

Non-goals (`:41-56`):
- NG-1 case editor ("Seam: a case is not required to have a source finding").
- NG-2 trend visualisations ("Seam: the run list returns each run's metrics, agent version, start time and cost").
- NG-3 model-based grading.
- NG-4 skill-owned cases.
- NG-5 automatic runs.
- NG-6 "any change in `reviewer-core/`".
- NG-7 MCP tool.
- NG-8 browser e2e flow.
- NG-9 gating on a metric.
- NG-10 "anything inside `evals/`".
- NG-11 the untrusted-data delimiter gap.
- NG-12 eval runs on existing run surfaces.
- NG-13 "Performing the homework experiment … the user does it with the feature".
- NG-14 "Run all agents".
- NG-15 "Promote vN".
- NG-16 per-case run icon.

Acceptance criteria. Wording is cut from the source; each line carries its pointer and state.

Creating a case — API (`:96-107`)
- AC-1 accepted finding without a case → "store one case owned by the agent of the finding's review with `expectation_type` `must_find` and answer 201" — `:96` — clear
- AC-2 dismissed → `must_not_flag`, 201 — `:97` — clear
- AC-3 `expected_output` holds "`file`, `start_line`, `end_line`, `severity`, `category` and `title`" — `:98` — clear
- AC-4 `input_diff` is "the unified diff of the source finding's file alone, taken from the pull request's diff at creation time, and in `input_files` that one path" — `:99` — clear
- AC-5 `input_meta` holds "the pull request's number, title, author and description" — `:100` — clear
- AC-6 name "`must-find-` … or `no-` … followed by the finding's title in lower case with every run of characters other than `a-z` and `0-9` replaced by one hyphen, cut to 34 characters" — `:101` — open → F1
- AC-7 neither accepted nor dismissed → "400 with code `finding_undecided`" — `:102` — clear
- AC-8 same `source_finding_id` exists → "200 with that case and store no second case" — `:103` — clear
- AC-9 review without agent, or agent gone → "400 with code `eval_owner_missing`" — `:104` — clear
- AC-10 file absent from the diff or range shares no line with a hunk → "400 with code `expectation_outside_diff`" — `:105` — clear
- AC-11 unknown finding or other workspace → 404 — `:106` — clear
- AC-12 decision changes, or finding / review / PR deleted → case unchanged — `:107` — clear

PR page (`:111-117`)
- AC-13 "a "Turn into eval case" control in the action row of every expanded finding card, after the Dismiss control" — `:111` — clear
- AC-14 undecided → "disabled with a hint that says to accept or dismiss the finding first" — `:112` — clear
- AC-15 titles "Create a 'must find' eval case from this finding" / "Create a 'must NOT comment' eval case from this dismissal" — `:113` — clear
- AC-16 "one `POST /findings/:id/eval-case` request … without asking for any input" — `:114` — clear
- AC-17 in flight → control disabled — `:115` — clear
- AC-18 200 or 201 → "a confirmation that names the expectation type and links to the Evals tab of the owning agent" — `:116` — clear
- AC-19 failure → "the API's message beside the control and leave the control enabled" — `:117` — clear

Case set (`:121-131`)
- AC-20 `GET /agents/:id/eval-cases` → "every case of that agent, oldest first, each with `last_result` taken from the newest completed run that covered it, or null" — `:121` — clear
- AC-21 "an Evals tab after the Context tab, selected through the `tab=evals` URL parameter" — `:122` — clear; label key already there `client/messages/en/agents.json:53`
- AC-22 row: name, expectation type in words, file with line range, severity and category — `:123` — clear
- AC-23 `last_result` as icon with text: passed / failed with "expected N, got M" / errored with reason / "never run" — `:124` — clear; `neverRun`, `passed`, `failed` keys already there `client/messages/en/eval.json:67-69`
- AC-24 number of cases and "P / R passing" — `:125` — clear
- AC-25 no case → message, no metric value, run control disabled — `:126` — clear (the reserved `emptyCases` text is replaced, DR-19 `:403`)
- AC-26 loading → "the loading text of the `eval` namespace" — `:127` — already there `client/messages/en/eval.json:65`
- AC-27 failed read → failure with retry "in place of the block that failed" — `:128` — clear
- AC-28 delete → confirmation dialog that names the case before `DELETE /eval-cases/:id` — `:129` — clear
- AC-29 delete leaves "every stored run, its metrics and its per-case outcome with the case's name unchanged" — `:130` — clear
- AC-30 agent deleted → its cases and runs deleted — `:131` — clear

Running — API (`:135-148`)
- AC-31 at least one case and no running run → store run `running` with current version and all case ids "whatever the agent's `enabled` flag, and answer 202 with the run before any case is executed" — `:135` — clear
- AC-32 each case "as one review of the case's `input_diff` by the review engine with the agent's current system prompt, provider, model, strategy and linked enabled skills" — `:136` — clear
- AC-33 "without a repo skeleton, a callers digest, a file-rank note, project context documents and a derived intent" — `:137` — clear
- AC-34 task line and description "from the case's `input_meta` and from no live pull request row" — `:138` — clear
- AC-35 model input "without the case's name, `expectation_type` and `expected_output`" — `:139` — clear
- AC-36 "byte-identical model input for the same case in two runs" — `:140` — clear
- AC-37 one case fails → outcome `error` with the message, remaining cases executed — `:141` — clear
- AC-38 all executed → `done` with metrics, outcomes, counts, findings produced and grounded, duration, cost sum ("null when any execution's cost is unknown") — `:142` — clear
- AC-39 no case → 400 `eval_no_cases` — `:143` — clear
- AC-40 no key → 400 `eval_provider_unavailable` — `:144` — clear
- AC-41 running → 400 `eval_run_in_progress` "and the id of the running run" — `:145` — clear
- AC-42 API start → every `running` run becomes `failed` with error "interrupted" — `:146` — clear
- AC-43 "no row to `reviews`, `findings`, `agent_runs` and `run_traces`" — `:147` — clear
- AC-44 other workspace → 404 on every eval route — `:148` — clear

Running — Evals tab (`:152-156`)
- AC-45 "a "Run all evals" control that states the number of cases" — `:152` — clear
- AC-46 one `POST /agents/:id/eval-runs` — `:153` — clear
- AC-47 newest run `running` → running state, control disabled, "also after the page is left and opened again" — `:154` — clear
- AC-48 reaches `done` → metrics, case outcomes and history row "without a page reload" — `:155` — clear
- AC-49 refused or `failed` → message or error, control enabled — `:156` — clear

Scoring (`:160-174`)
- AC-50 match = same `file` and "the two line ranges share at least one line" — `:160`
- AC-51 "only the findings that the engine's grounding gate kept" — `:161`
- AC-52 `must_find` pass on at least one match — `:162`
- AC-53 `must_not_flag` pass on no match — `:163`
- AC-54 `matched` recorded per outcome — `:164`
- AC-55 `recall` = `must_find` passed / `must_find` passed or failed — `:165`
- AC-56 `precision` = "one minus the number of grounded findings that match the expectation of their own `must_not_flag` case divided by the number of all grounded findings of the run" — `:166`
- AC-57 `citation_accuracy` = grounded / produced before the gate — `:167`
- AC-58 zero divisor → null — `:168`
- AC-59 `error` cases left out of every metric — `:169` — all clear
- AC-60 tiles as percentages with difference in points and direction; cases-passed tile — `:170` — clear
- AC-61 line "scoring is done in code … with no model call" — `:171` — clear
- AC-62 null metric → "—" and no difference — `:172` — clear
- AC-63 cases and no completed run → tiles without values and "the set was never run" — `:173` — clear
- AC-97 no model call on `POST /findings/:id/eval-case`, `DELETE /eval-cases/:id`, every `GET`, and scoring — `:174` — clear

History and comparison (`:178-194`)
- AC-64 `GET /agents/:id/eval-runs` "newest first, at most 20" — `:178` — clear
- AC-65 `GET /eval-runs/:id` with per-case outcomes — `:179` — clear
- AC-66 history table: start time, `vN`, three metrics, cases passed of covered, cost — `:180` — clear; column keys partly already there `client/messages/en/eval.json:21-28`
- AC-67 run stores provider, model, enabled skill names — `:181` — clear
- AC-68 exactly two completed selected → Compare enabled, "2 selected"; "a third selection replaces the earliest of the two" — `:182` — clear
- AC-69 fewer than two completed → Compare disabled with hint — `:183` — clear
- AC-70 compare → per run "its agent version, its system prompt from that version's stored snapshot, its metrics and its cost, ordered by start time whatever the order of the parameters" — `:184` — clear (see REC1)
- AC-71 not completed or not of that agent → 400 `eval_runs_not_comparable` — `:185` — clear
- AC-72 different case sets → metrics "computed over the cases that have a `pass` or `fail` outcome in both, with the names of the cases left out of each run" — `:186` — clear
- AC-73 compare view: older value, newer value, difference with direction for the three metrics and cost — `:187` — clear
- AC-74 title "Compare runs · vA → vB" — `:188` — clear
- AC-75 prompt difference "marked by a label or a text decoration in addition to colour" — `:189` — clear
- AC-76 identical prompts → says the prompt did not change — `:190` — clear
- AC-77 left-out cases → says so, lists them — `:191` — clear
- AC-78 provider / model / skill differences listed above the prompt difference — `:192` — clear
- AC-79 prompt changed between runs → later run has the higher version — `:193` — already there for the version bump `server/src/modules/agents/repository.ts:121-123`; the run storing it is new
- AC-80 later run with a matching grounded finding on a `must_not_flag` case → lower `precision` — `:194` — clear

Eval Dashboard (`:198-209`)
- AC-81 sidebar item "in the SKILLS LAB section after Conventions that links to `/eval` and is marked active on every path that starts with `/eval`" — `:198` — active key already there `client/src/components/app-shell/helpers.ts:35`; the item is missing from `client/src/vendor/ui/nav.ts:35-46`
- AC-82 `GET /eval/dashboard` → every agent with newest completed run or null, and the 6 newest completed runs with agent name — `:199` — clear
- AC-83 agent row: name, model, "Last run vN · start time · P/T pass", three metrics — `:200` — clear
- AC-84 "No eval runs yet" and "—" — `:201` — clear
- AC-85 table "Recent eval runs · all agents" or the empty text — `:202` — clear
- AC-86 row activation → "that agent's eval view at a URL of its own under `/eval`, which a reload restores" — `:203` — clear
- AC-87 view header: name, model, number of runs and cases, "All agents", agent switch — `:204` — clear
- AC-88 tiles with difference from previous completed run — `:205` — clear
- AC-89 view has history, selection, Compare, compare view and "Run eval" behaving as the Evals tab — `:206` — clear
- AC-90 banner "Precision dipped Npts on vK" — `:207` — clear
- AC-91 banner names the `must_not_flag` cases newly failing "and state no other cause" — `:208` — clear
- AC-92 "View full dashboard" link — `:209` — clear

Homework bar (`:213-216`)
- AC-93 8 cases with both types run and score as one run — `:213` — clear
- AC-94 fixture command "shall insert for that agent the fixture cases it does not hold yet and change no other row" — `:214` — clear
- AC-95 "The seed command and the API start shall create no eval case and no eval run" — `:215` — already there (`server/src/db/seed.ts` writes neither table); a test holds it
- AC-96 "The `verify:l06` command of `server/` shall exist as a script of `server/package.json` and exit with code 0 …" — `:216` — clear; verify is manual

NFR (`:254-266`): NFR-1 scoring imports no provider · NFR-2 one engine review per case · NFR-3 10 requests per minute · NFR-4 untrusted data only through the engine path · NFR-5 text never markup · NFR-6 Zod params and query, no body stored · NFR-7 both copies identical, the `eval-ci.ts` difference does not grow · NFR-8 new migration only, counts first · NFR-9 listed responses and `reviewer-core/` unchanged · NFR-10 strings from `client/messages/en/` · NFR-11 accessibility · NFR-12 two log lines without text · NFR-13 list bounds, reads from stored rows — all clear.

Edge cases EC-1…EC-31 (`:220-250`) are covered by the criteria they name. Open questions: none (`:498`).

## 2. Impact map

| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| server | `server/src/vendor/shared/contracts/eval.ts` | New | wire contract | NFR-7, contracts `:326-377` |
| client | `client/src/vendor/shared/contracts/eval.ts` | New (byte-identical) | wire contract | NFR-7 |
| both | `{server,client}/src/vendor/shared/contracts/knowledge.ts` | Modify — remove `EvalPerTrace`, `EvalRun`, `EvalCase` | wire contract | NFR-7 |
| both | `{server,client}/src/vendor/shared/contracts/eval-ci.ts` | Modify — remove `EvalRunRecord`, `EvalRunResult`, `EvalDashboard`, the `EvalRun` import | wire contract | NFR-7 |
| both | `{server,client}/src/vendor/shared/index.ts` | Modify — export `./contracts/eval.js` | barrel | NFR-7 |
| server | `server/test/contracts.test.ts` | Modify (`:12`, `:150` parse the old `EvalRun`) | test | NFR-7 |
| server | `server/test/eval-contracts.test.ts` | New | hermetic test | NFR-7 |
| server | `server/src/db/schema/eval.ts` | Modify | persistence schema | MI-13, NFR-8 |
| server | `server/src/db/migrations/0017_eval_pipeline.sql`, `meta/0017_snapshot.json`, `meta/_journal.json` | New / New / Modify — calling session | migration | NFR-8 |
| server | `server/src/modules/eval/scoring.ts` + `scoring.test.ts` | New | pure rule, single file | AC-50…59, NFR-1 |
| server | `server/src/domain/reviews/prompt-parts.ts` | New — `taskLine`, `renderSkillBlocks` moved from `modules/reviews/helpers.ts` | domain | AC-32, AC-34, NFR-4 |
| server | `server/src/modules/reviews/helpers.ts` | Modify — re-export the two functions | module | — |
| server | `server/src/modules/eval/{constants,types,helpers}.ts` | New | pure and ports | AC-3…6, AC-33…36, AC-72 |
| server | `server/test/eval-helpers.test.ts` | New | hermetic test | AC-35, AC-36, NFR-4 |
| server | `server/src/modules/eval/repository.ts` | New | driven adapter | MI-13 |
| server | `server/src/modules/eval/service.ts`, `runner.ts` | New | application | AC-1…12, 20, 29, 31…44, 64…72, 82 |
| server | `server/src/modules/eval/routes.ts` | New | driving adapter | routes `:366-377` |
| server | `server/src/modules/index.ts` | Modify — register `evals` | registry | — |
| server | `server/src/modules/reviews/service.ts` | Modify — two read methods | application | MI-2 |
| server | `server/src/platform/container.ts` | Modify — `evalRepo`, `reviewService`, `evalService` | composition root | — |
| server | `server/src/modules/agents/repository.ts` | Modify — `deleteById` in one transaction | driven adapter | AC-30, MI-12 |
| server | `server/src/app.ts` | Modify — reap interrupted eval runs at boot | composition root | AC-42 |
| server | `server/src/db/eval-fixtures.ts` | New | data-layer CLI, like `seed.ts` | AC-94 |
| server | `server/test/helpers/eval.ts` | New | test helper | — |
| server | `server/test/eval-cases.it.test.ts`, `eval-runs.it.test.ts`, `eval-compare.it.test.ts` | New | DB-backed tests | see stages 6–8 |
| server | `server/test/eval-case-name.test.ts` | New — waits for F1 | hermetic test | AC-6 |
| server | `server/package.json` | Modify — calling session | scripts | AC-96 |
| client | `client/src/lib/hooks/evals.ts` + `evals.test.tsx` | New | data access | MI-1, 3, 4, 8, 9, 10 |
| client | `client/messages/en/eval.json`, `prReview.json` | Modify | copy | NFR-10 |
| client | `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/navigation.test.tsx` | Modify | chrome | AC-81 |
| client | `client/src/lib/text-diff.ts` + `text-diff.test.ts` | New — moved from `VersionsTab/helpers.ts` (second route needs it) | domain-named lib file | AC-75 |
| client | `client/src/app/skills/_components/SkillDetail/_components/VersionsTab/{helpers.ts,helpers.test.ts,VersionsTab.tsx}` | Modify — the three functions leave, import path changes | route-local | — |
| client | `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/_components/EvalCaseAction/` | New | under its single parent | AC-13…19 |
| client | `…/FindingCard/FindingCard.tsx`, `FindingCard.test.tsx` | Modify | route-local | AC-13 |
| client | `client/src/components/eval-runs/` (`MetricTiles/`, `RunControl/`, `RunHistory/` with `_components/CompareRunsDialog/`, `helpers.ts`, `index.ts`) | New | cross-route tier — rendered by `/agents/[id]` and `/eval/[agentId]` | AC-45…49, 60, 62, 66, 68…78, 88, 89 |
| client | `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/` (with `_components/CaseList/`) | New | route-local | AC-21…28, 61, 63, 92 |
| client | `…/AgentEditor/AgentEditor.tsx`, `constants.ts`, `AgentEditor.test.tsx` | Modify | route-local | AC-21 |
| client | `client/src/app/eval/page.tsx`, `_components/EvalDashboard/` | New | route | AC-82…86 |
| client | `client/src/app/eval/[agentId]/page.tsx`, `_components/AgentEvalView/` | New | route | AC-86…91 |

Not in the map and not touched: `reviewer-core/**`, `mcp/**`, `e2e/**`, `evals/**`, `.claude/**`, lockfiles, `.env*`, `server/src/adapters/mocks.ts`, `server/src/db/seed.ts`.

## 3. Constraints in play

- dependency-cruiser stays green on all rules. The ones this change can trip:
  - `no-cross-module-internals` — the eval module may not import `reviews/helpers.ts` or any other module's `repository.ts`. Hence the move of the two prompt helpers to `src/domain/` and the ports in `eval/types.ts`.
  - `no-service-to-container` — `eval/service.ts` takes `EvalDeps`.
  - `drizzle-only-in-repositories` and `schema-only-in-repositories` — SQL only in `eval/repository.ts`, `agents/repository.ts` and `src/db/eval-fixtures.ts`.
  - `no-row-types-in-transport`, `no-domain-to-infra`, `no-circular`.
- `reviewer-core/` needs no change. `reviewPullRequest` already returns kept findings, `dropped`, `tokensIn/Out` and `costUsd` (`reviewer-core/src/review/run.ts:116-134`, `:236-247`). `assemblePrompt`, `groundFindings` and `reviewPullRequest` are exported (`reviewer-core/src/index.ts:15-27`). Proof at the end: `git status --short reviewer-core` prints nothing.
- Contracts: one stage, both copies. `contracts/eval.ts` is a new file so the two copies can be byte-identical, although `eval-ci.ts` and `knowledge.ts` already differ between the copies.
- Migration: hand-written `0017_eval_pipeline.sql` with snapshot and journal, by the calling session. No applied file is edited. Applying it to the dev DB is stage 16.
- Wire JSON snake_case; Drizzle camelCase in TS. `eval_runs.ran_at` keeps its column name and maps to `started_at` on the wire, so the migration needs no rename.
- Client: `import type` only from `@devdigest/shared`; no `fetch` in components; every string from `client/messages/en/`; counts as ICU plurals; `{x, number}` for values that can pass 999.
- Tests: `*.it.test.ts` for anything importing `test/helpers/pg.ts`. Client tests use `fireEvent`, real message files and a mocked `fetch`.
- Scoring stays one pure file with no import at all, with its test beside it, for the later mutation-testing task (SPEC-08).
- Seams kept for SPEC-04 and SPEC-05:
  - `eval_cases.source_finding_id` is nullable, and a run covers every case of the agent whatever its origin.
  - The run list record carries metrics, `agent_version`, `started_at`, `cost_usd`.
  - `EvalCaseInput` and `EvalTrendPoint` stay untouched in `eval-ci.ts`; `caseEditor.*` and `dashboard.metricTrend` keys stay in `eval.json`.
  - `CaseList` has a header slot and `MetricTiles` / `RunHistory` are siblings in their parents, so a modal and a chart are additions.

## 4. Stages

### Stage 1 — Contracts in both copies
Track: shared · After: —
Files: `server/src/vendor/shared/contracts/eval.ts` (New), `client/src/vendor/shared/contracts/eval.ts` (New), both `contracts/knowledge.ts`, both `contracts/eval-ci.ts`, both `index.ts`, `server/test/contracts.test.ts`, `server/test/eval-contracts.test.ts` (New)
Read first: `specs/2026-10-12-eval-pipeline.md:320-377` — the contract tables; `server/src/vendor/shared/contracts/knowledge.ts:45-90` and `eval-ci.ts:1-95` — the reserved declarations; `server/src/vendor/shared/index.ts` — barrel form; `server/test/contracts.test.ts:1-20,130-165` — the test that parses the old `EvalRun`; `server/src/vendor/shared/contracts/findings.ts:1-40` — schema style.
Steps:
1. Write `contracts/eval.ts`. It imports `z` and `EvalOwnerKind` from `./knowledge.js` (that enum stays where it is). Each schema is exported with a type of the same name:
   - `EvalExpectationType` = `z.enum(['must_find','must_not_flag'])`.
   - `EvalExpectedOutput` = `{ file, start_line: int, end_line: int, severity: string, category: string, title }`. Severity and category are plain strings (EC-31).
   - `EvalInputMeta` = `{ pr_number: int, pr_title, pr_author, pr_body: string.nullable() }`.
   - `EvalOutcomeStatus` = `z.enum(['pass','fail','error'])`.
   - `EvalCaseLastResult` = `{ run_id, status: EvalOutcomeStatus, matched: int, error: string.nullable() }`.
   - `EvalCase` = `{ id, owner_kind: EvalOwnerKind, owner_id, name, expectation_type, expected_output, input_diff: string, input_files: string[], input_meta, source_finding_id: string.nullable(), notes: string.nullable(), created_at, last_result: EvalCaseLastResult.nullable() }`.
   - `EvalRunStatus` = `z.enum(['running','done','failed'])`.
   - `EvalOutcomeFinding` = `{ file, start_line, end_line, severity, category, title }`.
   - `EvalCaseOutcome` = `{ case_id, case_name, expectation_type, status, matched: int, findings: EvalOutcomeFinding[], error: string.nullable() }`.
   - `EvalRun` = the run record of `:344-361` without `results`. The three metrics are `z.number().min(0).max(1).nullable()`.
   - `EvalRunDetail` = `EvalRun.extend({ results: z.array(EvalCaseOutcome) })`.
   - `EvalCompareSide` = the object of `:376`.
   - `EvalRunCompare` = `{ base, head, cases_only_in_base: string[], cases_only_in_head: string[] }`.
   - `EvalDashboardAgent` = `{ agent_id, name, model, latest_run: EvalRun.nullable() }`.
   - `EvalDashboard` = `{ agents: EvalDashboardAgent[], recent_runs: z.array(EvalRun.extend({ agent_name: z.string() })) }`.
2. Copy the file byte for byte into the client copy.
3. In both `knowledge.ts`: delete `EvalPerTrace`, `EvalRun`, `EvalCase`. In both `eval-ci.ts`: delete `EvalRunRecord`, `EvalRunResult`, `EvalDashboard` and drop `EvalRun` from the import line. Change nothing else in these files.
4. Add `export * from './contracts/eval.js';` to both `index.ts`, in the form the neighbours use.
5. `server/test/contracts.test.ts`: replace the old `EvalRun.parse({...})` with a parse of the new run record with `recall: null`.
6. `server/test/eval-contracts.test.ts`: read both `contracts/eval.ts` files with `node:fs` and expect equal text. Expect that neither `knowledge.ts` nor `eval-ci.ts` of either copy contains `EvalRunRecord`, `EvalRunResult` or `EvalPerTrace`.
Skills: `zod` → `references/type-export-schemas-and-types.md`, `references/object-optional-vs-nullable.md`, `references/schema-use-enums.md` — same-name type export, `nullable` for stored nulls, enums for closed sets. `onion-architecture` → `rules/zod-contracts.md` — a contract is a transport shape, both copies change together; `rules/testing.md` — hermetic test name.
Tests to add: `server/test/eval-contracts.test.ts` — NFR-7.
Done when: `diff -u server/src/vendor/shared/contracts/eval.ts client/src/vendor/shared/contracts/eval.ts` prints nothing; `grep -rn "EvalRunRecord\|EvalRunResult\|EvalPerTrace" server/src client/src` prints nothing; `.claude/agents/scripts/check-code.sh server -- contracts` and `.claude/agents/scripts/check-code.sh --no-tests client` are green.

### Stage 2 — Drizzle schema of the two reserved tables
Track: shared · After: 1
Files: `server/src/db/schema/eval.ts`
Read first: `server/src/db/schema/eval.ts` — the tables to reshape; `server/src/db/schema/knowledge.ts:44-90` — `convention_scans`: status enum, jsonb defaults, the partial unique index; `server/src/db/schema/_shared.ts` — `now()` is `created_at` only; `server/src/db/schema/agents.ts:1-50` — FK form.
Steps:
1. `evalCases`: keep every existing column. Add `$type<string[]>()` on `inputFiles`, `$type<…>()` on `inputMeta` and `expectedOutput` with inline structural types (no module import). Add:
   - `expectationType: text('expectation_type', { enum: ['must_find','must_not_flag'] }).notNull()`
   - `sourceFindingId: uuid('source_finding_id')` — nullable, no foreign key (AC-12, NG-1)
   - `createdAt: now()`
   - index `eval_cases_owner_idx` on `(ownerKind, ownerId)`
   - `uniqueIndex('eval_cases_source_finding_uq').on(t.sourceFindingId).where(sql\`source_finding_id is not null\`)`
2. `evalRuns`: remove `caseId`, `actualOutput`, `pass`. Keep `id`, `ranAt`, `recall`, `precision`, `citationAccuracy`, `durationMs`, `costUsd`. Add:
   - `workspaceId` uuid notNull → `workspaces.id` on delete cascade
   - `agentId` uuid notNull → `agents.id` on delete cascade
   - `agentVersion` integer notNull
   - `status: text('status', { enum: ['running','done','failed'] }).notNull().default('running')`
   - `error` text
   - `casesTotal`, `casesPassed`, `casesFailed`, `casesErrored`, `findingsTotal`, `findingsGrounded` — integer notNull default 0
   - `provider`, `model` — text notNull
   - `skills`, `caseIds` — `jsonb().$type<string[]>().notNull().default([])`
   - `results` — `jsonb().$type<…>().notNull().default([])`
   - index `eval_runs_agent_ran_idx` on `(agentId, ranAt)`
   - `uniqueIndex('eval_runs_one_running_idx').on(t.agentId).where(sql\`status = 'running'\`)`
3. Write the two `where` texts exactly as above: stage 3's snapshot repeats them character for character.
Skills: `drizzle-orm-patterns` → `references/schema-definition.md` — column builders, `$type`, index callbacks. `postgresql-table-design` → `SKILL.md § Constraints`, `§ Indexing`, `§ JSONB Guidance` — partial unique indexes as the concurrency guard, jsonb for the per-run outcome document.
Tests to add: none — the tables are exercised from stage 6.
Done when: `.claude/agents/scripts/check-code.sh --no-tests server` is green. No migration is generated here.

### Stage 3 — Migration `0017_eval_pipeline` (CALLING SESSION)
Track: calling session · After: 2
Files: `server/src/db/migrations/0017_eval_pipeline.sql` (New), `server/src/db/migrations/meta/0017_snapshot.json` (New), `server/src/db/migrations/meta/_journal.json`
Read first: `server/src/db/migrations/meta/0016_snapshot.json:2724-2900` — the two table objects to patch; `:1760-1830` — the index and partial-index object shapes of `convention_scans`; `server/src/db/migrations/0013_conventions_scan.sql` — statement-breakpoint form.
Steps:
1. Write `0017_eval_pipeline.sql`, one statement per line, each followed by `--> statement-breakpoint` except the last:
```sql
ALTER TABLE "eval_runs" DROP CONSTRAINT "eval_runs_case_id_eval_cases_id_fk";
ALTER TABLE "eval_runs" DROP COLUMN "case_id";
ALTER TABLE "eval_runs" DROP COLUMN "actual_output";
ALTER TABLE "eval_runs" DROP COLUMN "pass";
ALTER TABLE "eval_cases" ADD COLUMN "expectation_type" text NOT NULL;
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "workspace_id" uuid NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "agent_id" uuid NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "status" text DEFAULT 'running' NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "error" text;
ALTER TABLE "eval_runs" ADD COLUMN "cases_total" integer DEFAULT 0 NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "cases_passed" integer DEFAULT 0 NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "cases_failed" integer DEFAULT 0 NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "cases_errored" integer DEFAULT 0 NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "findings_total" integer DEFAULT 0 NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "findings_grounded" integer DEFAULT 0 NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "provider" text NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "model" text NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "case_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "eval_runs" ADD COLUMN "results" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "eval_cases_owner_idx" ON "eval_cases" USING btree ("owner_kind","owner_id");
CREATE UNIQUE INDEX "eval_cases_source_finding_uq" ON "eval_cases" USING btree ("source_finding_id") WHERE source_finding_id is not null;
CREATE INDEX "eval_runs_agent_ran_idx" ON "eval_runs" USING btree ("agent_id","ran_at");
CREATE UNIQUE INDEX "eval_runs_one_running_idx" ON "eval_runs" USING btree ("agent_id") WHERE status = 'running';
```
   The file holds no `DELETE` and no `TRUNCATE`. A `NOT NULL` column without a default fails on a non-empty table, which is the stop NFR-8 asks for.
2. Build `meta/0017_snapshot.json` from `0016_snapshot.json`:
   - `prevId` = `d184db9e-73dd-4545-a3f2-0dd2a34c3776`; `id` = a fresh uuid.
   - Patch only `public.eval_cases` and `public.eval_runs`: the columns, `indexes` and `foreignKeys` of step 1.
   - Copy object shapes from `convention_scans`: `"default": "'[]'::jsonb"`; an index object with `"isUnique"`, `"concurrently": false`, `"method": "btree"`, `"with": {}`; the partial ones with `"where": "source_finding_id is not null"` and `"where": "status = 'running'"`.
   - Remove `eval_runs_case_id_eval_cases_id_fk`.
3. Append `{ "idx": 17, "version": "7", "when": <Date.now()>, "tag": "0017_eval_pipeline", "breakpoints": true }` to `_journal.json`.
4. Run `cd server && pnpm exec drizzle-kit generate`. Expected: `No schema changes, nothing to migrate`. Any prompt or any new file means the snapshot and the schema disagree: stop it, delete what it wrote, fix the snapshot.
Skills: `drizzle-orm-patterns` → `references/migrations.md` — snapshot and journal are part of a migration. `postgresql-table-design` → `SKILL.md § Safe Schema Evolution` — additive columns with defaults; drops only on columns nothing reads.
Tests to add: none; every `.it` suite migrates its own container with this file.
Done when: step 4 prints "No schema changes"; `git status --short server/src/db/migrations` shows exactly two new files and `_journal.json` modified.

### Stage 4 — Scoring: one pure file
Track: server · After: 3
Files: `server/src/modules/eval/scoring.ts` (New), `server/src/modules/eval/scoring.test.ts` (New)
Read first: `specs/2026-10-12-eval-pipeline.md:86-92,158-174` — terms and the ten scoring criteria; `reviewer-core/src/grounding.ts:41-46` — how a range is normalised (min/max); `server/vitest.config.ts` — `src/**/*.test.ts` is collected.
Steps:
1. `scoring.ts` has no import statement of any kind. It exports:
   - `type ExpectationType = 'must_find' | 'must_not_flag'`
   - `interface LineRange { file: string; startLine: number; endLine: number }`
   - `matchesExpectation(finding: LineRange, expectation: LineRange): boolean` — same `file`, and the two ranges, each normalised with min/max, share a line.
   - `interface CaseExecution { expectationType; expectation: LineRange; kept: LineRange[]; dropped: LineRange[] }`
   - `interface CaseTally { expectationType; status: 'pass' | 'fail' | 'error'; matched: number; grounded: number; produced: number }`
   - `scoreCase(e: CaseExecution): CaseTally`:
     - `matched` counts `kept` only (AC-51, AC-54).
     - `must_find` passes on `matched >= 1`; `must_not_flag` passes on `matched === 0`.
     - `grounded = kept.length`; `produced = kept.length + dropped.length`.
   - `errorTally(expectationType): CaseTally` — status `error`, zeros.
   - `interface RunScore { recall, precision, citationAccuracy: number | null; casesTotal, casesPassed, casesFailed, casesErrored, findingsTotal, findingsGrounded: number }`
   - `scoreRun(tallies: CaseTally[]): RunScore`. Error tallies count only in `casesTotal` and `casesErrored` (AC-59). Over the rest:
     - recall = `must_find` passed / `must_find` scored.
     - precision = 1 − (sum of `matched` over `must_not_flag` tallies) / (sum of `grounded`).
     - citation accuracy = sum of `grounded` / sum of `produced`.
     - A zero divisor gives `null` (AC-58).
2. No rounding and no clock; no `Date` and no `Math.random`.
Skills: `onion-architecture` → `rules/domain-purity.md` — "can this run in a test with no Docker, no network, no clock"; `rules/tracing.md § 3` — a pure file stays pure one call deep; `rules/testing.md` — pure inputs, no doubles.
Tests to add: `server/src/modules/eval/scoring.test.ts`, one case per `verify:` line of AC-50…AC-59:
   - ranges 10–12 and 12–20 match; another file, or 10–11 and 12–20, do not;
   - a dropped overlapping finding gives no match;
   - `must_find` one match and none; `must_not_flag` none and one;
   - two overlaps give `matched` 2;
   - 3 of 4 gives recall 0.75;
   - one `must_not_flag` case with four grounded findings, one matching, gives precision 0.75;
   - 3 kept and 1 dropped gives 0.75;
   - `must_not_flag` only gives recall null; no findings gives precision and citation null;
   - three cases with one `error` score as the other two.
Done when: `.claude/agents/scripts/check-code.sh server -- src/modules/eval/scoring` is green; `grep -n "import" server/src/modules/eval/scoring.ts` prints nothing (NFR-1).

### Stage 5 — Eval module core: constants, ports, pure helpers; the shared prompt parts
Track: server · After: 4
Files: `server/src/domain/reviews/prompt-parts.ts` (New), `server/src/modules/reviews/helpers.ts`, `server/src/modules/eval/constants.ts` (New), `types.ts` (New), `helpers.ts` (New), `server/test/eval-helpers.test.ts` (New)
Read first: `server/src/modules/reviews/helpers.ts:78-125` — `taskLine`, `PromptSkill`, `renderSkillBlocks` to move; `server/src/domain/reviews/current-opinion.ts` — the domain file style; `server/src/modules/brief/types.ts` — a module's consumer-declared ports; `reviewer-core/src/review/run.ts:57-134` — `ReviewInput` and `ReviewOutcome`; `server/src/adapters/git/diff-parser.ts:1-30` — `parseUnifiedDiff`; `reviewer-core/src/review/reduce.ts:59-73` — why `sliceDiff` is not used (its `includes` test also matches `web/src/a.ts` for `src/a.ts`); `server/test/prompt-structured.test.ts` — how a test reads the assembled messages.
Steps:
1. Move `taskLine`, `PromptSkill` and `renderSkillBlocks` verbatim into `src/domain/reviews/prompt-parts.ts`. The parameter of `taskLine` becomes `{ number: number; title: string; author: string }`, which a `PullRow` satisfies. In `modules/reviews/helpers.ts` replace the three declarations with a re-export from the domain file, so `run-executor.ts` and the two existing tests keep their imports.
2. `eval/constants.ts`:
   - `EVAL_CASE_SLUG_MAX = 34` — the number in the wording of AC-6; see F1.
   - `EVAL_RUN_LIST_LIMIT = 20`, `EVAL_RECENT_RUNS_LIMIT = 6`.
   - `EVAL_RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }`.
   - `EVAL_INTERRUPTED_ERROR = 'interrupted'`.
   - the error codes: `finding_undecided`, `eval_owner_missing`, `expectation_outside_diff`, `eval_no_cases`, `eval_provider_unavailable`, `eval_run_in_progress`, `eval_runs_not_comparable`.
3. `eval/types.ts` — camelCase internal shapes and the ports. No row type, no Drizzle import.
   - `StoredCase`.
   - `StoredOutcome` = the wire outcome in camelCase plus `produced: number`, which is internal and needed to recompute citation accuracy over common cases (AC-72).
   - `StoredRun`.
   - `EvalStore` — the repository port; its methods are listed in stages 6–8.
   - `EvalAgentRecord` = `{ id, name, provider, model, systemPrompt, strategy, version }`.
   - `EvalAgentsReader` = `{ list(workspaceId), getById(workspaceId, id), getVersion(agentId, version): Promise<{ configJson: unknown } | undefined> }`.
   - `EvalSkillsReader` = `{ linkedEnabled(agentId): Promise<PromptSkill[]> }`.
   - `EvalFindingOrigin` = `{ finding: { id, file, startLine, endLine, severity, category, title, acceptedAt, dismissedAt }, agentId: string | null, pull: { id, number, title, author, body } }`.
   - `EvalFindingSource` = `{ findingOrigin(workspaceId, findingId): Promise<EvalFindingOrigin | undefined>; diffForPull(workspaceId, prId): Promise<UnifiedDiff> }`.
   - `EvalLogger` = `{ info(obj: unknown, msg?: string): void; warn(obj: unknown, msg: string): void }`.
   - `EvalDeps` = `{ store, agents, skills, findings, llm(id), log }`.
4. `eval/helpers.ts` — pure, time passed in as a parameter:
   - `evalCaseName(type, title)`: `must-find-` or `no-`, then the title in lower case with `/[^a-z0-9]+/g` replaced by `-`, cut to `EVAL_CASE_SLUG_MAX`. Nothing is trimmed: the wording of AC-6 names no trim.
   - `expectationTypeOf({ acceptedAt, dismissedAt })` → the type or `null`.
   - `extractFileDiff(raw: string, path: string): string | null` — split `raw` at lines starting `diff --git `; keep the segment whose header line ends with ` b/${path}`; null when there is none.
   - `expectationInsideDiff(fileDiff: UnifiedDiff, finding)`: call `groundFindings` with one probe finding whose `kind` is `'finding'` and return whether it was kept. A full-file kind outside every hunk is then refused, as EC-6 requires, by the engine's own gate.
   - `buildCaseReviewInput(agent: EvalAgentRecord, skills: PromptSkill[], c: StoredCase)` → `{ systemPrompt, model, strategy, skills?, diff: parseUnifiedDiff(c.inputDiff), prDescription?, task }`.
     - `task` = `taskLine({ number: prNumber, title: prTitle, author: prAuthor })` from `inputMeta`.
     - `skills` = `renderSkillBlocks(...)`, omitted when empty; `prDescription` omitted when the body is null or empty.
     - It never sets `specs`, `callers`, `repoMap`, `intent`, `memory` (AC-33).
     - It never reads `c.name`, `c.expectationType`, `c.expectedOutput` (AC-35).
   - `toCaseDto`, `toRunDto`, `toRunDetailDto` — snake_case mappers; `toRunDetailDto` drops `produced`.
   - `lastResultFor(caseId, doneRunsNewestFirst)` → the outcome of the first run whose `caseIds` holds the id, or null.
   - `compareSides(base, head)`:
     - common = case ids with `pass` or `fail` in both;
     - re-score each side over common through `scoreRun`;
     - return the two scores, `casesTotal` / `casesPassed` over common, and the names left out of each side.
Skills: `onion-architecture` → `rules/layers.md § Cross-module rules` — "If two modules need the same pure logic, it goes to the domain"; `rules/ports-and-di.md` — "A port is defined by the consumer"; `rules/domain-purity.md` — forbidden imports in `src/domain`; `rules/tracing.md § 3` — helpers take time as a parameter. `typescript-expert` (by content: structural port types) → `SKILL.md`.
Tests to add: `server/test/eval-helpers.test.ts`:
   - `buildCaseReviewInput` passed through `assemblePrompt({ system, skills, prDescription, task, diff: diff.raw })`:
     - the messages hold none of the case's name, type or expected title (AC-35);
     - two builds give equal strings (AC-36);
     - the diff and the description stand inside `<untrusted` blocks and the system message holds neither (NFR-4);
     - no `## Project context`, callers, repo map or intent section (AC-33).
   - `extractFileDiff` on a three-file diff holding `src/a.ts` and `web/src/a.ts` returns only the asked file.
   - `expectationInsideDiff` refuses a `secret_leak` finding outside every hunk (EC-6).
   - `compareSides` with one case missing from the older run (AC-72, pure half).
   - `lastResultFor` with a case created after the newest run.
   The AC-6 example is not asserted here — stage 14.
Done when: `.claude/agents/scripts/check-code.sh server -- eval-helpers reviews-helpers skills-extract prompt-structured` is green (typecheck and depcruise run as part of it).

### Stage 6 — Cases: repository, use cases, routes, agent deletion
Track: server · After: 5
Files: `server/src/modules/eval/repository.ts` (New), `service.ts` (New), `routes.ts` (New), `server/src/modules/index.ts`, `server/src/modules/reviews/service.ts`, `server/src/platform/container.ts`, `server/src/modules/agents/repository.ts`, `server/test/helpers/eval.ts` (New), `server/test/eval-cases.it.test.ts` (New)
Read first: `server/src/modules/brief/{routes,repository}.ts` and `service.ts:1-60` — the module pattern to follow; `server/src/platform/container.ts:100-125,155-200,262-282` — getters; `server/src/modules/reviews/service.ts:34-45,150-190` with `diff-loader.ts` and `repository/review.repo.ts:96-118` — `findingContext`, `loadDiff`; `server/src/modules/agents/repository.ts:60-85` — `deleteById`; `server/src/modules/skills/repository.ts:128-160` — a transaction in a repository; `server/test/reviews.it.test.ts:1-140` — app, mocks, `setupRepoAndPr`; `server/src/adapters/mocks.ts:46-113,265-300` — `MockLLMProvider.calls`, `MockGitClient`.
Steps:
1. `ReviewService` gains two reads; nothing else in it changes:
   - `findingOrigin(workspaceId, findingId)` — `repo.findingContext`; `undefined` when missing or of another workspace; returns the plain object of `EvalFindingOrigin` (no row type crosses).
   - `diffForPull(workspaceId, prId)` — `getPull` + `getRepo` + the existing `loadDiff`; `NotFoundError` when the pull is missing.
2. `EvalRepository implements EvalStore`, case half. Every method takes `workspaceId` and maps rows at its own edge:
   - `findCaseBySourceFinding`
   - `insertCase` — `onConflictDoNothing` on the partial unique index, then select, so two clicks yield one row (AC-8, EC-2)
   - `listCasesForAgent` — `created_at` ascending
   - `getCase`, `deleteCase`
   - `listDoneRunsForAgent(agentId, limit)` — id, case ids and results only
3. `EvalService(deps: EvalDeps)`:
   - `createCaseFromFinding(workspaceId, findingId)` → `{ case, created }`, checks in this order:
     - origin missing → `NotFoundError`;
     - existing case by source finding → return it;
     - undecided → `AppError('finding_undecided', …, 400)`;
     - `agentId` null or `agents.getById` empty → `eval_owner_missing`;
     - `diffForPull`, then `extractFileDiff` null or `expectationInsideDiff` false → `expectation_outside_diff`;
     - insert with `ownerKind: 'agent'`, the six expectation values, the one-file diff, `[file]`, the four meta values.
   - `listCases(workspaceId, agentId)` — 404 for an unknown agent; `last_result` through `lastResultFor`.
   - `deleteCase(workspaceId, caseId)` — 404 when absent.
4. `routes.ts`, schema-first, one service call each, `service = app.container.evalService`:
   - `POST /findings/:id/eval-case` — `IdParams`, no body schema, `response: { 200: EvalCase, 201: EvalCase }`, `reply.status(created ? 201 : 200)`.
   - `GET /agents/:id/eval-cases` — `response: { 200: z.array(EvalCase) }`.
   - `DELETE /eval-cases/:id` → `{ ok: true }`.
   Register the module as `evals` in `modules/index.ts`.
5. Container:
   - `get evalRepo()`;
   - `get reviewService()` → `new ReviewService(this)`;
   - `get evalService()` → `new EvalService({ store: this.evalRepo, agents: this.agentsRepo, skills: this.skillsRepo, findings: this.reviewService, llm: (id) => this.llm(id), log: this.logger })`.
6. `AgentsRepository.deleteById`: one `db.transaction` — delete `eval_cases` where `owner_kind = 'agent'` and `owner_id = id` (workspace-scoped), then the agent. `eval_runs` rows go by the new FK cascade. The return value is unchanged.
7. `test/helpers/eval.ts`: `insertEvalAgent`, `insertDecidedFinding(db, { prId, agentId, decision, file, startLine, endLine })` (inserts a review and a finding row), `waitForEvalRun(app, runId)` (polls `GET /eval-runs/:id` until not `running`; used from stage 7).
Skills: `onion-architecture` → `rules/fastify-transport.md` — "A route does exactly four things"; `rules/errors.md` — `AppError` with a stable code, no raw `Error`; `rules/ports-and-di.md` — the composition root is the only place with `new`; `rules/drizzle-persistence.md` — row types stay inside the repository; `rules/testing.md` — `.it.test.ts`. `fastify-best-practices` → `rules/routes.md`, `rules/schemas.md`, `rules/testing.md` — declared params and response schemas, `app.inject()`. `drizzle-orm-patterns` → `references/transactions.md`, `references/queries-joins-aggregations.md`. `zod` → `references/parse-validate-early.md`. `security` → `SKILL.md`, `checklists.md` — ids validated, workspace scoping on every read and write, no client-supplied diff stored (NFR-6).
Tests to add: `server/test/eval-cases.it.test.ts`:
   - AC-1, AC-2, AC-3, AC-5.
   - AC-4 on a PR with three `pr_files` rows.
   - AC-7, AC-9 (agent row deleted), AC-10 (lines outside every hunk), AC-11 and AC-44 (second workspace, the three routes).
   - AC-8: two calls, one row, same id, 201 then 200.
   - AC-12: dismiss the finding, delete the review, read back identical.
   - AC-20 with no run: `last_result` null, oldest first.
   - AC-30: `eval_cases` holds no row of the deleted agent.
   - NFR-6: non-uuid → 422; a body with `input_diff` is not stored.
   - AC-97, routes half: `MockLLMProvider.calls` stays empty.
   - AC-95: both tables empty after migrate, `seed` and `buildApp`.
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval-cases.it agents-versions.it reviews.it` is green; the report says whether Docker ran the suites.

### Stage 7 — Runs: start, execute, score, settle, reap
Track: server · After: 6
Files: `server/src/modules/eval/runner.ts` (New), `repository.ts`, `service.ts`, `routes.ts`, `server/src/app.ts`, `server/test/eval-runs.it.test.ts` (New)
Read first: `server/src/modules/reviews/run-executor.ts:296-320,354-414` — provider resolution, skills and the engine call a live review makes; `server/src/modules/reviews/service.ts:107-155` — create up front, then fire-and-forget; `server/src/app.ts:76-93` — the boot reaper; `server/src/modules/reviews/routes.ts:25-31` — the rate-limit config; `server/docs/prompt-logging.md` — never log section text; `server/src/modules/conventions/service.ts` — find the handling of a partial-unique-index conflict (`grep -n "one_running\|23505" server/src/modules/conventions/*.ts`).
Steps:
1. Repository, run half:
   - `insertRunningRun(values)` — a unique violation on `eval_runs_one_running_idx` returns `null`
   - `findRunningRun(agentId)`
   - `completeRun(runId, patch)` — one update: status, metrics, counts, results, duration, cost
   - `listRunsForAgent(workspaceId, agentId, limit)` — newest first, without `results`
   - `getRun(workspaceId, runId)`
   - `failRunningRuns(error)` — returns the count
2. `service.startRun(workspaceId, agentId)`:
   - agent missing → 404;
   - `listCasesForAgent` empty → `eval_no_cases`;
   - `findRunningRun` → `AppError('eval_run_in_progress', …, 400, { run_id })`;
   - `await deps.llm(provider)` inside try → on throw `eval_provider_unavailable` (400), nothing stored;
   - `skills.linkedEnabled`;
   - `insertRunningRun` with `agentVersion`, `provider`, `model`, skill names, `caseIds`, `casesTotal`; `null` → `eval_run_in_progress` with the id read again;
   - log the start line;
   - `void executeEvalRun(...).catch(log.warn)`;
   - return the run DTO.
   The `enabled` flag is never read (EC-26).
3. `runner.ts` — `executeEvalRun(deps, { run, agent, skills, llm, cases })`. Cases are executed in order, one at a time. For each:
   - `reviewPullRequest({ ...buildCaseReviewInput(agent, skills, c), llm, sessionId: \`eval:${run.id}\` })`;
   - on success `scoreCase` with `kept = outcome.review.findings` and `dropped = outcome.dropped.map(d => d.finding)`;
   - on throw `errorTally` plus the message (AC-37).
   Then `scoreRun`; the cost sum is null as soon as one successful execution's cost is null; `completeRun` with `done`; log the settle line. No `repo.insertReview`, no `createAgentRun`, no `saveRunTrace` (AC-43).
4. Both log lines carry `runId`, `agentId`, `agentVersion`, the case counts, the three metrics, `tokensIn`, `tokensOut`, `costUsd`, `durationMs`. They never carry diff, expectation or finding text (NFR-12).
5. `service.listRuns`, `service.getRun`, `service.reapInterruptedRuns()` → `failRunningRuns('interrupted')`. From this stage `listCases` reads real `last_result`.
6. Routes:
   - `POST /agents/:id/eval-runs` — `config: { rateLimit: EVAL_RUN_RATE_LIMIT }`, `reply.status(202)`, `response: { 202: EvalRun }`
   - `GET /agents/:id/eval-runs`
   - `GET /eval-runs/:id` — `EvalRunDetail`
7. `app.ts`: after the existing reaper, call `container.evalService.reapInterruptedRuns()` in the same try/log form (non-fatal).
Skills: `onion-architecture` → `rules/layers.md` — orchestration in the service, rule in `scoring.ts`; `rules/errors.md`; `rules/fastify-transport.md` — the route maps 202 only; `rules/tracing.md § 4` — no adapter constructed in the module. `fastify-best-practices` → `rules/routes.md`, `rules/testing.md`. `security` → `SKILL.md`, `checklists.md` — untrusted diff and PR text reach the model only through `assemblePrompt`; the rate limit on the paid route. `drizzle-orm-patterns` → `references/queries-joins-aggregations.md`.
Tests to add: `server/test/eval-runs.it.test.ts`, with a test-local scripted `LLMProvider` (a queue of results or throws per call, recording requests):
   - AC-31: 202 body with `running`, version, case ids; a disabled agent runs.
   - AC-32 and NFR-2: one structured call per case; the system message holds the prompt, the user message the case diff.
   - AC-33: agent with `repoIntel` on and attached documents.
   - AC-34: PR title changed after creation.
   - AC-37: throw on the second of three.
   - AC-38 and AC-65: settled run read.
   - AC-39, AC-40 (container whose `llm` override is absent and whose secrets are empty), AC-41 (a blocked first run, a second call).
   - AC-42: a `running` row inserted before `buildApp`.
   - AC-43: four row counts.
   - AC-44: the run routes.
   - AC-64 and NFR-13: 21 stored runs → 20, no `results` key.
   - AC-67: two linked skills.
   - AC-29: a run read before and after a case delete is equal.
   - AC-20: one covered case, one created later.
   - AC-93: eight cases of both types.
   - NFR-3: the route config equals `EVAL_RUN_RATE_LIMIT`.
   - NFR-12: a service built directly with a capturing logger — two records, no fixture diff text.
   - AC-97, scoring half: `scoreRun` over stored outcomes with the provider's `calls` unchanged.
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval-runs.it eval-cases.it routes-smoke` is green.

### Stage 8 — Compare, dashboard, fixture command
Track: server · After: 7
Files: `server/src/modules/eval/service.ts`, `repository.ts`, `routes.ts`, `server/src/db/eval-fixtures.ts` (New), `server/test/eval-compare.it.test.ts` (New)
Read first: `server/src/modules/agents/repository.ts:148-190` — `snapshotVersion` and `getVersion`; `server/src/modules/agents/helpers.ts:32-45` — `AgentVersionConfig.parse`; `server/src/db/seed.ts:1-60,352-374` — the CLI entry form; `server/src/modules/eval/helpers.ts` (stage 5) — `compareSides`.
Steps:
1. `service.compareRuns(workspaceId, agentId, baseId, headId)`:
   - agent → 404;
   - both runs must exist, belong to the agent and be `done`, else `AppError('eval_runs_not_comparable', …, 400)`;
   - order by `ranAt`, the older is `base` (AC-70);
   - `agents.getVersion(agentId, run.agentVersion)` and `system_prompt` read from `configJson` with a narrow Zod object; a missing or malformed snapshot → `eval_runs_not_comparable` (MI-6 `:280`);
   - metrics, `cases_total`, `cases_passed` from `compareSides`; `cost_usd`, provider, model, skills from the stored run.
2. `service.dashboard(workspaceId)`:
   - `agents.list`;
   - `store.latestDoneRunPerAgent(workspaceId)` — one query, `DISTINCT ON (agent_id)`;
   - `store.recentDoneRuns(workspaceId, EVAL_RECENT_RUNS_LIMIT)`;
   - agent names joined in the service.
3. Routes:
   - `GET /agents/:id/eval-runs/compare` — `querystring: z.object({ base: z.string().uuid(), head: z.string().uuid() })`, `response: { 200: EvalRunCompare }`
   - `GET /eval/dashboard` — `response: { 200: EvalDashboard }`
4. `src/db/eval-fixtures.ts`:
   - `EVAL_FIXTURE_CASES` — eight cases named `fixture-…`, at least three `must_not_flag`, each with a small one-file diff whose expectation lies inside its hunk, `source_finding_id` null.
   - `insertEvalFixtures(db, workspaceId, agentId)` — inserts the ones whose `(owner_kind, owner_id, name)` is absent and returns the inserted count.
   - CLI entry like `seed.ts`: `--agent "<name>"` required; resolves the default workspace and the agent by name; exits 1 when either is missing; prints the count. Nothing imports this file from `seed.ts`, `app.ts` or `scripts/dev.sh`.
Skills: `onion-architecture` → `rules/errors.md`, `rules/drizzle-persistence.md` — read models stay inside the repository; `rules/zod-contracts.md` — parse the stored snapshot at the edge. `fastify-best-practices` → `rules/schemas.md` — `querystring`. `drizzle-orm-patterns` → `references/queries-joins-aggregations.md`. `security` → `checklists.md` — the compare query validated; the other agent's run answers 400, another workspace 404.
Tests to add: `server/test/eval-compare.it.test.ts`:
   - AC-79: run, `PUT /agents/:id` with a new prompt, run, compare → two versions and two prompts.
   - AC-70: `base` / `head` swapped give the same body.
   - AC-71: a `running` run and a run of another agent.
   - AC-72: a case added between the runs.
   - AC-80: the scripted provider returns an overlapping finding in the second run only → lower precision.
   - AC-82: three agents, one without runs, eight runs → six recent.
   - AC-44 for the two routes; a compare query that is not a uuid → 422.
   - NFR-13: `MockGitClient` and `MockGitHubClient` record no call on the reads.
   - AC-94: `insertEvalFixtures` twice leaves the same rows; the row counts of `agents`, `findings`, `reviews`, `eval_runs` are unchanged.
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval-` is green and its `Test Files` count is 6 (`eval-cases.it`, `eval-runs.it`, `eval-compare.it`, `eval-helpers`, `eval-contracts`, and `scoring` if the filter matched it; state the count seen).

### Stage 9 — Client foundation: hooks, copy, sidebar, text diff
Track: client · After: 1
Files: `client/src/lib/hooks/evals.ts` (New), `evals.test.tsx` (New), `client/messages/en/eval.json`, `client/messages/en/prReview.json`, `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/navigation.test.tsx`, `client/src/lib/text-diff.ts` (New), `client/src/lib/text-diff.test.ts` (New), `client/src/app/skills/_components/SkillDetail/_components/VersionsTab/{helpers.ts,helpers.test.ts,VersionsTab.tsx}`
Read first: `client/src/lib/hooks/reviews.ts:1-70` — polling with `refetchInterval`, settle refresh; `client/src/lib/hooks/brief.test.tsx:1-60` — hook test harness; `client/src/lib/api.ts` — `ApiError`; `client/messages/en/eval.json` — reserved keys; `client/src/vendor/ui/nav.ts:20-47`; `client/src/components/app-shell/navigation.test.tsx`; `client/src/app/skills/_components/SkillDetail/_components/VersionsTab/helpers.ts`.
Steps:
1. `evals.ts`, types imported with `import type` only:
   - `evalKeys` factory: `cases(agentId)`, `runs(agentId)`, `run(runId)`, `compare(agentId, base, head)`, `dashboard()`.
   - `useCreateEvalCase()` — POST without body; on success invalidates `cases(owner_id)`.
   - `useEvalCases(agentId)`.
   - `useDeleteEvalCase(agentId)`.
   - `useEvalRuns(agentId)` — `refetchInterval` 3000 while the first row is `running`; when the first row leaves `running`, invalidate `cases(agentId)`, `dashboard()` and the run detail.
   - `useStartEvalRun(agentId)` — writes the 202 run to the head of the `runs` cache.
   - `useEvalRun(runId)`, `useEvalCompare(agentId, base, head)` (enabled with both ids), `useEvalDashboard()`.
2. `eval.json` — keep every existing key (`caseEditor.*`, `dashboard.metricTrend`, `page.*` included). Change `evalsTab.emptyCases` to a text that says a case is created from an accepted or a dismissed finding on a pull request (DR-19). Add the keys below. Text in quotes is fixed by a criterion; the rest is the implementer's wording under the given key.
   - `runs.metrics.{recall,precision,citationAccuracy,casesPassed}`
   - `runs.percent` "{value}%"
   - `runs.noValue` "—"
   - `runs.delta` "{points}pt"
   - `runs.direction.{up,down,same}`
   - `runs.casesRatio` "{passed}/{total}"
   - `runs.runAll` "Run all evals ({count, number})"
   - `runs.runOne` — reuse `dashboard.runEval`
   - `runs.runningLabel`
   - `runs.status.{started,done,failed}` — live-region texts; `failed` takes `{error}`
   - `runs.history.{title,startedAt,version,cases,cost,empty,selectRun}`
   - `runs.history.versionValue` "v{version}"
   - `runs.history.selected` "{count} selected"
   - `runs.history.compare` "Compare"
   - `runs.history.compareHint`
   - `runs.compare.title` "Compare runs · v{base} → v{head}"
   - `runs.compare.{close,metric,older,newer,difference,cost,promptHeading,promptUnchanged,added,removed,differentCases,onlyIn,configHeading,provider,model,skills,loadError}`
   - `evalsTab.count` — plural "# case / # cases"
   - `evalsTab.passing` "{passed} / {run} passing"
   - `evalsTab.expectation.{mustFind,mustNotFlag}`
   - `evalsTab.errored` — takes `{reason}`
   - `evalsTab.expectedGot` "expected {expected}, got {got}"
   - `evalsTab.{deleteTitle,deleteBody,neverRunSet,scoringNote,loadError,retry}` — `deleteBody` takes `{name}`
   - `evalsTab.viewDashboard` "View full dashboard"
   - `dashboard.lastRun` "Last run v{version} · {time} · {passed}/{total} pass"
   - `dashboard.noRunsYet` "No eval runs yet"
   - `dashboard.recentTitle` "Recent eval runs · all agents"
   - `dashboard.{recentEmpty,agent,loadError,retry}`
   - `agentView.allAgents` "All agents"
   - `agentView.{switchAgent,summary}` — `summary` with plural runs and cases
   - `agentView.banner` "Precision dipped {points}pts on v{version}"
   - `agentView.bannerCases` — takes `{names}`
3. `prReview.json`, under `finding.evalCase`:
   - `action` "Turn into eval case"
   - `titleAccepted` "Create a 'must find' eval case from this finding"
   - `titleDismissed` "Create a 'must NOT comment' eval case from this dismissal"
   - `undecidedHint`, `createdMustFind`, `createdMustNotFlag`, `openEvals`
4. `nav.ts`: add `{ key: "eval", label: "Eval Dashboard", icon: "FlaskConical", href: "/eval" }` to SKILLS LAB after `conventions`. No `gKey`: the shortcut list is not part of the spec.
5. Move `DiffOp`, `DiffLine`, `diffLines`, `diffStat`, `collapseUnchanged` unchanged into `src/lib/text-diff.ts`, and their tests into `text-diff.test.ts`. `VersionsTab.tsx` imports from `@/lib/text-diff`. `VersionsTab/helpers.ts` and its test are deleted if nothing remains in them.
Skills: `frontend-ui-architecture` → `placement.md § Utils, helpers, lib, services` — a second route's consumer earns a domain-named file, "move the file, do not parameterize"; `devdigest.md § Data access` — hooks are the only path to server data. `react-best-practices` → `SKILL.md § Data Fetching`. `react-testing-library` → `SKILL.md § Query Priority`, with `fireEvent` per `client/INSIGHTS.md`.
Tests to add:
   - `evals.test.tsx` — the runs query polls while the first row is `running`, stops on `done` and invalidates the cases key; `useCreateEvalCase` sends one POST without a body.
   - `navigation.test.tsx` — the item exists, comes right after Conventions, has `href` `/eval`, is active for `activeKeyFor("/eval/a1")`; its label equals `shell.json` `nav.eval` (AC-81).
   - `text-diff.test.ts` — the moved cases.
Done when: `.claude/agents/scripts/check-code.sh client -- evals.test navigation.test text-diff.test VersionsTab.test` is green; `grep -rn "VersionsTab/helpers" client/src` prints nothing.

### Stage 10 — PR page: "Turn into eval case"
Track: client-pr · After: 9
Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/_components/EvalCaseAction/{EvalCaseAction.tsx,EvalCaseAction.test.tsx,index.ts}` (New), `…/FindingCard/FindingCard.tsx`, `…/FindingCard/FindingCard.test.tsx`
Read first: `…/FindingCard/FindingCard.tsx` — the action row at `:91-112`; `…/FindingCard/FindingCard.test.tsx:1-80` — its render helper (no `QueryClientProvider` today); `…/FindingCard/styles.ts`; `client/docs/findings-surfaces.md` — which screens render the card (`FindingsPanel`, `DiffTab`); `client/src/lib/hooks/evals.ts` (stage 9); `client/src/vendor/ui/primitives/Button.tsx` — `title`, `disabled`, `icon` props.
Steps:
1. `EvalCaseAction({ finding })` owns its own `useCreateEvalCase()` instance, so the pending state is per finding (AC-17). It renders:
   - A native `Button` (`kind="ghost"`, `size="sm"`, `icon="FlaskConical"`) labelled `finding.evalCase.action`.
   - Undecided: `disabled`, `title` and a visible or `aria-describedby` hint from `undecidedHint` (AC-14).
   - Decided: `title` from `titleAccepted` / `titleDismissed` (AC-15); `disabled` while pending.
   - On success: beside the button, the text `createdMustFind` / `createdMustNotFlag` chosen by the returned `expectation_type`, and a Next `Link` to `/agents/${case.owner_id}?tab=evals` (AC-18).
   - On error: the `ApiError` message as text; the button stays enabled (AC-19).
   - A click only calls `mutate(finding.id)`; no dialog, no form (AC-16).
2. `FindingCard.tsx`: render `<EvalCaseAction finding={f} />` in `s.actions` after the Dismiss button. No other change to the card.
3. `FindingCard.test.tsx`: wrap the render helper in a `QueryClientProvider`; existing assertions stay.
Skills: `frontend-ui-architecture` → `placement.md § Sub-component ownership` — a part only one parent renders lives in that parent's folder. `react-best-practices` → `SKILL.md § Accessibility`, `§ Derive, Don't Store` — confirmation and error come from the mutation state, not copied into `useState`. `react-testing-library` → `SKILL.md § Query Priority`.
Tests to add: `EvalCaseAction.test.tsx`:
   - accessible name and position after Dismiss (AC-13, through `FindingCard`);
   - disabled with the hint when undecided (AC-14);
   - the two titles (AC-15);
   - one mocked request, no dialog (AC-16);
   - a second click during a pending request sends none (AC-17);
   - confirmation text and `href` with `tab=evals` (AC-18);
   - a mocked 400 `expectation_outside_diff` shows its message and leaves the button enabled (AC-19).
Done when: `.claude/agents/scripts/check-code.sh client -- EvalCaseAction.test FindingCard.test FindingsPanel.test` is green; compare `Test Files` with the suites named.

### Stage 11 — Shared eval-runs components
Track: client-runs · After: 9
Files: `client/src/components/eval-runs/` (New): `MetricTiles/{MetricTiles.tsx,MetricTiles.test.tsx,index.ts}`, `RunControl/{RunControl.tsx,RunControl.test.tsx,index.ts}`, `RunHistory/{RunHistory.tsx,RunHistory.test.tsx,styles.ts,index.ts}`, `RunHistory/_components/CompareRunsDialog/{CompareRunsDialog.tsx,CompareRunsDialog.test.tsx,index.ts}`, `helpers.ts`, `helpers.test.ts`, `index.ts`
Read first: `client/src/components/project-context/index.ts` and its folder — the shape of a cross-route component group; `client/src/vendor/ui/charts/MetricCard.tsx` — the tile primitive; `client/src/components/confirm-dialog/ConfirmDialog.tsx` — Escape, focus trap, focus return over `Modal`; `client/src/vendor/ui/kit/Modal.tsx`; `client/src/components/run-cost/helpers.ts` — `formatUsd`, `NO_COST`; `client/src/app/skills/_components/SkillDetail/_components/VersionsTab/VersionsTab.tsx:40-60` — how diff lines are rendered with a sign; `docs/design/Dev Digest 2/Dev Digest/screen_skills.jsx:285-329,395-445` — compare modal and history frames; `client/src/lib/hooks/evals.ts`.
Steps:
1. `helpers.ts`, pure:
   - `toPercent(value: number | null): number | null` — rounded integer
   - `deltaPoints(newer, older)` — null when either is null
   - `completedRuns(runs)`
   - `nextSelection(selected: string[], id: string): string[]` — toggles; a third id drops the earliest (AC-68)
   - `costDelta`
2. `MetricTiles({ latest, previous })` — both are `EvalRun | null`.
   - Four tiles: recall, precision, citation accuracy as "N%" with `runs.delta` and a direction icon carrying an accessible label; cases passed as `runs.casesRatio` (AC-60).
   - A null metric shows `runs.noValue` and no delta (AC-62).
   - With `latest` null the tiles show no values (AC-63).
   - The component takes no `children` and holds no chart; parents place it.
3. `RunControl({ agentId, caseCount, variant })` — `variant` is `"all" | "one"` and picks `runs.runAll` or `dashboard.runEval`.
   - A native button.
   - Disabled when `caseCount === 0` or the newest run is `running` (read from `useEvalRuns`).
   - `useStartEvalRun`.
   - A `role="status"` live region announcing started / done / failed (NFR-11).
   - On a refused start or a `failed` newest run: the API message or the run's `error` as text, with the button enabled (AC-49).
4. `RunHistory({ agentId })` — owns the selection state and the dialog.
   - A real `<table>` with the columns of AC-66: `vN`, percentages, `passed/total`, `formatUsd`.
   - A native checkbox per completed row with an accessible name from `runs.history.selectRun`; `running` and `failed` rows have none.
   - "N selected".
   - The Compare button is enabled with exactly two selected, and disabled with `compareHint` when there are fewer than two completed runs (AC-69).
   - Opens `CompareRunsDialog` with the two ids.
5. `CompareRunsDialog({ agentId, baseId, headId, onClose })` — a `Modal` with the Escape and focus-return behaviour of `ConfirmDialog`. Content from `useEvalCompare`:
   - title `runs.compare.title` (AC-74);
   - a table: older, newer, difference with direction for the three metrics and cost (AC-73) — the cost difference has direction and no good-or-bad colour;
   - when provider, model or skills differ, a list above the prompt section (AC-78);
   - when `cases_only_in_*` is non-empty, the notice and the names (AC-77);
   - the prompt diff from `diffLines` + `collapseUnchanged`, each changed line carrying a visible `+` / `−` sign and an `added` / `removed` label for assistive text (AC-75), or `promptUnchanged` when the prompts are equal (AC-76);
   - a Close button only (NG-15);
   - on a failed read, the API message.
6. Every name, prompt and finding text is rendered as a React text node; no `dangerouslySetInnerHTML` (NFR-5).
Skills: `frontend-ui-architecture` → `placement.md § Components` — "Rendered by 2+ routes, knows the domain → `components/<name>/`"; `composition.md` — when to split; `boundaries.md` — one-line barrels. `react-best-practices` → `SKILL.md § Derive, Don't Store`, `§ Key Prop Patterns`, `§ Accessibility`. `react-testing-library` → `SKILL.md § Query Priority`.
Tests to add:
   - `helpers.test.ts` — `nextSelection` (one, two, a third); `deltaPoints` with null.
   - `MetricTiles.test.tsx` — two runs give "82%", "4pt" and an up marker, "17/20" (AC-60); `recall` null gives "—" and no delta (AC-62); no run gives no values (AC-63).
   - `RunControl.test.tsx` — the text for 8 cases (AC-45); one request (AC-46); disabled on a `running` first row (AC-47); a mocked 400 `eval_run_in_progress` and a `failed` run show the text with the button enabled (AC-49); live-region text after a status change (NFR-11).
   - `RunHistory.test.tsx` — two rows in order (AC-66); select one, two, a third (AC-68); one completed run disables Compare with the hint (AC-69).
   - `CompareRunsDialog.test.tsx` — 78% → 82% "4pt" up, 0.21 → 0.23 "0.02" (AC-73); title for 6 and 7 (AC-74); an added line marked as added (AC-75); identical prompts (AC-76); one case left out (AC-77); different models (AC-78); Escape closes and focus returns to Compare (NFR-11); a prompt holding `<img src=x onerror=alert(1)>` is visible text and no `img` exists (NFR-5).
Done when: `.claude/agents/scripts/check-code.sh client -- eval-runs` is green with `Test Files 5`.

### Stage 12 — Evals tab of the agent editor
Track: client-tab · After: 11
Files: `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/{EvalsTab.tsx,EvalsTab.test.tsx,styles.ts,index.ts}` (New), `…/EvalsTab/_components/CaseList/{CaseList.tsx,CaseList.test.tsx,index.ts}` (New), `…/AgentEditor/AgentEditor.tsx`, `…/AgentEditor/constants.ts`, `…/AgentEditor/AgentEditor.test.tsx`
Read first: `…/AgentEditor/AgentEditor.tsx`, `constants.ts`, `AgentEditor.test.tsx` — tab wiring and the tab-order assertion; `…/AgentEditor/_components/ContextTab/ContextTab.tsx` and `ContextTab.test.tsx:1-80` — a tab with its own queries and the test harness; `client/src/components/eval-runs/index.ts` (stage 11); `client/src/components/confirm-dialog/ConfirmDialog.tsx:1-45` — props; `docs/design/Dev Digest 2/Dev Digest/screen_agents.jsx:163-200` and `components2.jsx:75-90` — the tab frame and a case row.
Steps:
1. `constants.ts`: add `{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }` after `context`. `AgentEditor.tsx`: render `<EvalsTab key={agent.id} agent={agent} />` for `tab === "evals"`.
2. `EvalsTab({ agent })` composes siblings in this order:
   - a header row with `evalsTab.count`, `evalsTab.passing` (R = cases with a `last_result`, P = those passed), `<RunControl variant="all" …/>` and the Next `Link` `evalsTab.viewDashboard` to `/eval/${agent.id}` (AC-92);
   - `<MetricTiles latest previous />` from the two newest completed runs of `useEvalRuns`;
   - the `evalsTab.scoringNote` line (AC-61);
   - `evalsTab.neverRunSet` when there are cases and no completed run (AC-63);
   - `<CaseList …/>`;
   - `<RunHistory agentId />`.
   States:
   - With no case: the empty message, no tiles' values, the control disabled (AC-25).
   - The case block and the runs block each show their own loading text (`evalsTab.loadingCases`, AC-26).
   - Each block shows its own failure with a retry button that refetches only that query (AC-27).
3. `CaseList({ cases, agentId })`:
   - A header with a right-aligned actions area — empty here; it is the place of SPEC-04's button.
   - A row per case: name; `expectation.mustFind` / `mustNotFlag`; `file:start–end` as a plain mono `span` (not `MonoLink`); severity and category as text.
   - The `last_result` state as an icon plus text: passed or failed with `expectedGot` (expected is 1 for `must_find` and 0 for `must_not_flag`, got is `matched`); `errored` with the reason; `neverRun` (AC-23).
   - A native delete button with an accessible name that includes the case name.
   - Delete opens `ConfirmDialog` with `deleteBody` naming the case; the request is sent on confirm only; a failure is passed as `error` (AC-28, MI-3).
Skills: `frontend-ui-architecture` → `placement.md § Sub-component ownership`, `§ Nesting` — the tab is the fourth level, `CaseList` its only child folder. `react-best-practices` → `SKILL.md § Derive, Don't Store` (P / R derived from the query data), `§ Conditional Rendering`, `§ Accessibility`. `react-testing-library` → `SKILL.md § Query Priority`; tab order is read from the buttons' parent, per `client/INSIGHTS.md § Tool & Library Notes`.
Tests to add:
   - `AgentEditor.test.tsx` — Evals comes after Context and renders for `tab="evals"` (AC-21).
   - `CaseList.test.tsx` — a `must_find` and a `must_not_flag` row (AC-22); the four `last_result` states (AC-23); no request before confirm, one after (AC-28); a case named `<img src=x onerror=alert(1)>` is text (NFR-5).
   - `EvalsTab.test.tsx` — 5 cases, 4 run, 3 passed → "3 / 4 passing" and "5 cases" (AC-24); the empty list (AC-25); a pending request (AC-26); a mocked 500 and one more request after retry (AC-27); a run read that goes `running` → `done` shows tiles and the history row (AC-48); the scoring line (AC-61); the link `href` (AC-92).
Done when: `.claude/agents/scripts/check-code.sh client -- EvalsTab.test CaseList.test AgentEditor.test` is green with `Test Files 3`.

### Stage 13 — Eval Dashboard and the agent's eval view
Track: client-dash · After: 11
Files: `client/src/app/eval/page.tsx` (New), `client/src/app/eval/_components/EvalDashboard/{EvalDashboard.tsx,EvalDashboard.test.tsx,styles.ts,index.ts}` (New), `client/src/app/eval/[agentId]/page.tsx` (New), `client/src/app/eval/[agentId]/_components/AgentEvalView/{AgentEvalView.tsx,AgentEvalView.test.tsx,helpers.ts,helpers.test.ts,index.ts}` (New)
Read first: `client/src/app/agents/page.tsx` — a list page inside `AppShell` with crumbs; `client/src/components/page-shell/PageShell.tsx`; `client/src/components/eval-runs/index.ts` (stage 11); `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/agents.ts:15-30`; `client/src/lib/model-label.ts`; `docs/design/Dev Digest 2/Dev Digest/screen_skills.jsx:330-445` — both frames; `client/messages/en/eval.json` — `dashboard.*`, `agentView.*`, `page.*`.
Steps:
1. `eval/page.tsx` — a server component that returns `<EvalDashboard />`. `eval/[agentId]/page.tsx` — `export default async function Page({ params }: { params: Promise<{ agentId: string }> })`, awaits `params` and returns `<AgentEvalView agentId={agentId} />`. The two `_components` are `"use client"`.
2. `EvalDashboard` — `AppShell` with crumbs from `page.crumbSkillsLab` / `page.crumbEvalDashboard`; `useEvalDashboard()`.
   - A row per agent as a Next `Link` to `/eval/${agent_id}`: name, model, `dashboard.lastRun` (time through the locale formatter) and the three percentages. For `latest_run` null: `dashboard.noRunsYet` and three "—" (AC-83, AC-84).
   - Under it the table `dashboard.recentTitle`: one row per run — agent name, start time, `vN`, three metrics, `passed/total` — each row a link to that agent's view. Or `dashboard.recentEmpty` (AC-85, AC-86).
   - Loading and failure with retry.
   - No "Run all agents" control (NG-14).
3. `AgentEvalView({ agentId })` — `useAgent`, `useAgents`, `useEvalRuns`, `useEvalCases`.
   - Header: name, model, `agentView.summary` (runs and cases), a `Link` `agentView.allAgents` to `/eval`, a `Dropdown` `agentView.switchAgent` listing the other agents and navigating to `/eval/${id}`, and `<RunControl variant="one" …/>` (AC-87, AC-89).
   - Then siblings in this order: the banner, `<MetricTiles/>`, `<RunHistory/>`. A chart of SPEC-05 goes between the last two.
   - Banner: `helpers.ts` `precisionDip(latest, previous)` → `{ points, version } | null` when both precisions are non-null and the newer is lower. Then `useEvalRun` for the two runs and `newlyFailingMustNotFlag(latestDetail, previousDetail)` → names of `must_not_flag` cases `fail` now and `pass` before. Render `agentView.banner`, plus `agentView.bannerCases` when there are names; no other cause is stated (AC-90, AC-91).
Skills: `next-best-practices` → `async-patterns.md` — `params` is a Promise in Next 15; `rsc-boundaries.md` — route roots stay server components, the client boundary is the leaf; `file-conventions.md`. `frontend-ui-architecture` → `devdigest.md § Where the codebase diverges` — "new routes should start server-first"; `placement.md § Components`. `react-best-practices` → `SKILL.md § Data Fetching`, `§ Accessibility`. `react-testing-library` → `SKILL.md § Query Priority`; the filter is a file-name fragment because of the `[agentId]` segment.
Tests to add:
   - `EvalDashboard.test.tsx` — a row from a mocked response (AC-83); an agent with `latest_run` null (AC-84); six recent rows and the empty text (AC-85); row link targets (AC-86).
   - `AgentEvalView.test.tsx` — header texts and the two navigation targets (AC-87); tiles from two completed runs (AC-88); select two rows, open the compare view, start a run (AC-89); 0.93 then 0.91 on version 7 gives "2pts" and "v7" while equal values give no banner (AC-90); one newly failing `must_not_flag` case is named, and with none the banner ends after the version (AC-91).
   - `helpers.test.ts` — the two pure functions.
Done when: `.claude/agents/scripts/check-code.sh client -- EvalDashboard.test AgentEvalView.test` is green with `Test Files 2`, plus `-- eval/[agentId]/_components/AgentEvalView/helpers.test` run unescaped and quoted.

### Stage 14 — AC-6 example check (waits for F1)
Track: server · After: 5 and the answer to F1
Files: `server/test/eval-case-name.test.ts` (New), `server/src/modules/eval/constants.ts` (only if the answer changes the number)
Read first: `specs/2026-10-12-eval-pipeline.md:101` (or the superseding spec's AC-6); `server/src/modules/eval/helpers.ts` — `evalCaseName`; `docs/design/Dev Digest 2/Dev Digest/findings.jsx:30-36` — the prototype's rule.
Steps:
1. Assert `evalCaseName` on the title of AC-6's `verify:` line against the expected string the source gives once F1 is settled, and the `no-` prefix for `must_not_flag`.
2. If the settled rule differs from the wording planned in stage 5, change `EVAL_CASE_SLUG_MAX` (or the trim) in the one place it lives.
Skills: `onion-architecture` → `rules/testing.md` — pure inputs, hermetic name.
Tests to add: `server/test/eval-case-name.test.ts` — AC-6.
Done when: `.claude/agents/scripts/check-code.sh server -- eval-case-name` is green.

### Stage 15 — `verify:l06` and the static checks an implementer cannot run (CALLING SESSION)
Track: calling session · After: 8, 10, 12, 13
Files: `server/package.json`
Read first: `server/package.json:5-17` — the scripts block; `server/INSIGHTS.md:104-114` — the `/tmp` tsconfig recipe; `client/INSIGHTS.md:82-83` — the build-on-a-copy recipe.
Steps:
1. Add to `scripts` in `server/package.json`, after `"test"`: `"verify:l06": "vitest run src/modules/eval/ test/eval-"`. The file shows in `git status` like any other change (`git ls-files -v server/package.json` prints `H`).
2. Type-check the new server test files. Write `/tmp/tsconfig.eval-tests.json`:
   `{"extends":"<repo>/server/tsconfig.json","compilerOptions":{"noEmit":true,"rootDir":"<repo>","typeRoots":["<repo>/server/node_modules/@types"]},"include":["<repo>/server/src/**/*.ts","<repo>/server/test/eval-*.ts","<repo>/server/test/helpers/eval.ts","<repo>/server/test/contracts.test.ts"]}`
   Run `server/node_modules/.bin/tsc -p /tmp/tsconfig.eval-tests.json`. Expected: exit 0, no output. An error in an eval test goes back to the server track as a fix brief.
3. Client build on a copy, never in the live `client/`:
   `rsync -a --exclude .next --exclude node_modules client/ /tmp/dd-client-build/ && ln -s "$PWD/client/node_modules" /tmp/dd-client-build/node_modules && (cd /tmp/dd-client-build && ./node_modules/.bin/next build); rm -rf /tmp/dd-client-build`
   Expected: the build lists `/eval` and `/eval/[agentId]`. A `Module not found: Can't resolve ./contracts/…js` means a value import from `@devdigest/shared`.
4. Run the rows of §6.
Skills: none routed (`server/package.json` and `/tmp` files are outside every lane).
Tests to add: none.
Done when: `cd server && pnpm verify:l06` exits 0 with Docker running (the report states the `.it` suites ran, not skipped); steps 2 and 3 are clean; every §6 row is green.

### Stage 16 — Migration on the dev DB (CALLING SESSION)
Track: calling session · After: 15
Files: none in the repository; the dev database `devdigest` in `devdigest-postgres`
Read first: `INSIGHTS.md:37-41` — the dry-run recipe; `specs/2026-10-12-eval-pipeline.md:248,261` — EC-29 and NFR-8.
Steps, in this order. A stop at step 1 is a stop for the user's decision.
1. Count: `docker exec devdigest-postgres psql -U devdigest -d devdigest -Atc "select (select count(*) from eval_cases), (select count(*) from eval_runs), (select count(*) from drizzle.__drizzle_migrations)"`. Expected `0|0|17` (measured 2026-10-12; newest `0016_huge_inhumans`). If the migrations table is not found under `drizzle.`, find it with `\dt *.*drizzle*`. Any non-zero count in the first two → stop and ask the user (EC-29).
2. Backup: `docker exec devdigest-postgres pg_dump -U devdigest -Fc devdigest > /tmp/devdigest-pre-eval-<stamp>.dump`. Keep it until the user has looked.
3. Copy: `createdb -U devdigest devdigest_evalcheck`, then `pg_restore --no-owner -U devdigest -d devdigest_evalcheck` from the dump, inside the same container.
4. Before-export of the copy: for every table except `eval_cases` and `eval_runs`, a sorted `psql -At -c "select * from <table>"` into `/tmp/evalcheck/before/<table>.txt`.
5. Dry run: `cd server && DATABASE_URL=postgres://devdigest:devdigest@localhost:5432/devdigest_evalcheck pnpm db:migrate`.
6. After-export, then `comm -23 before/<t>.txt after/<t>.txt` per table. Every result must be empty (no line removed or changed). `\d eval_cases` and `\d eval_runs` show the new columns and four indexes.
7. `dropdb -U devdigest devdigest_evalcheck`.
8. Real DB: the same export, `cd server && pnpm db:migrate`, the same diff. Then the count of step 1 again: `0|0|18`.
Skills: `postgresql-table-design` → `SKILL.md § Safe Schema Evolution`.
Tests to add: none (NFR-8 is a manual verify).
Done when: both diffs are empty and the migration count is 18. Evidence: the dump path, the two diff summaries, the `\d` output.

### Stage 17 — Live verification and the experiment (CALLING SESSION)
Track: calling session · After: 16
Files: none in the repository except the screenshot under `specs/fixtures/eval-pipeline/` (New folder) and the notes the user asks for
Read first: `INSIGHTS.md:43-44,205-207` — the model-call proof and the detached start; `server/INSIGHTS.md:84-91` — `tsx watch` and `vendor/`, the latency of `deepseek/deepseek-v4-flash`.

Subject: **Test Quality Reviewer**. It holds 30 of the 54 findings, so it is the only agent from which eight or more distinct cases of both types can be picked while leaving room for refusals (EC-4, EC-5, EC-6) and for duplicates of one problem across runs (EC-3). General Reviewer and API Contract Reviewer hold 8 each: every finding would have to pass AC-10 and none could be a duplicate. Security Reviewer (5) and Performance Reviewer (1) cannot reach eight. Its findings are about tests, where "real gap" and "noise" are easy to tell apart by reading the diff, which gives honest `must_not_flag` cases.

Steps, in order, with the evidence each leaves:
1. Start the stack: `setsid nohup ./scripts/dev.sh --no-seed > /tmp/devdigest-dev.log 2>&1 &`. It applies no new migration (stage 16 did). Evidence: `GET http://localhost:3001/health` is 200; `ps -eo pid,etime,cmd | grep dev.sh`.
2. Baseline of facts, read-only psql:
   - counts of `agent_runs`, `run_traces`, `reviews`, `findings`, `eval_cases`, `eval_runs`;
   - the subject's `id`, `version`, `provider`, `model` (expected `openrouter` / `deepseek/deepseek-v4-flash`; any other model → stop);
   - whether `agent_versions` holds a row for its current version (question 3);
   - the list of its findings with `id`, `file`, lines, `title`, `accepted_at`, `dismissed_at`, newest review per PR first.
   Evidence: the query output saved to `/tmp`.
3. No-model-call proof: open `/eval`, `/eval/<agentId>`, `/agents/<agentId>?tab=evals` and a PR page; take the `agent_runs` / `run_traces` counts again. Evidence: equal counts (US-12, AC-97).
4. Decisions:
   - Take a second `pg_dump` first.
   - On the PR pages accept at least five findings that name a real gap and dismiss at least four that are noise. Choose distinct file-and-line targets, and leave the one already-accepted finding as it is.
   - Record every finding id whose decision was set, so the user can undo it.
   - Click "Turn into eval case" on each. A refusal (`expectation_outside_diff`) is expected for some; go on to the next candidate until the set holds at least 8 cases with at least 3 `must_not_flag`.
   Evidence: `select expectation_type, count(*) from eval_cases group by 1`; a screenshot of the Evals tab list. If the real findings do not yield both types, the fixture command fills the gap: `cd server && pnpm exec tsx src/db/eval-fixtures.ts --agent "Test Quality Reviewer"`, run first on a restored copy with the row diff of stage 16, then on the real DB.
5. Run 1 — baseline prompt: "Run all evals" on the Evals tab. Evidence: the run row (`vN`, three metrics, cost); the two log lines in `/tmp/devdigest-dev.log`; the `agent_runs` and `run_traces` counts unchanged (AC-43).
6. Run 2 — improved prompt:
   - Edit the system prompt in the Config tab, adding instructions that address what the dismissed cases show (what not to comment on) and what the missed `must_find` cases show.
   - Save (version N+1), then run.
   Evidence: the run row; the tiles with the difference from run 1.
7. Run 3 — deliberately broken prompt:
   - Replace the added part with an instruction that produces noise (for example, to comment on every changed test line, style included).
   - Save (N+2), then run.
   Evidence: the run row with lower precision than run 2 (US-9, AC-80); the banner on `/eval/<agentId>` naming the `must_not_flag` cases that newly fail.
8. Compare: select runs 2 and 3 on the history table and open Compare. Evidence: the screenshot `specs/fixtures/eval-pipeline/compare-v<N+1>-v<N+2>.png` showing the metric differences and the prompt diff. A second one for runs 1 and 2 when the baseline version has a snapshot.
9. Restore the prompt per question 2. Evidence: `GET /agents/<id>` shows the chosen text; the list of versions created.
10. Spend: sum `cost_usd` of the three eval runs. Evidence: one line in the report. No other model and no review run is started.
Done when: the set holds at least 8 cases of both types; three `done` runs exist on three versions; the compare screenshot exists; the counts of step 3 and step 5 held.

## 5. Skills matrix

| Stage | onion-architecture | fastify-best-practices | drizzle-orm-patterns | postgresql-table-design | zod | security | frontend-ui-architecture | react-best-practices | next-best-practices | react-testing-library | typescript-expert |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `rules/zod-contracts.md`, `rules/testing.md` | — | — | — | `references/type-export-schemas-and-types.md`, `object-optional-vs-nullable.md`, `schema-use-enums.md` | — | — | — | — | — | — |
| 2 | — | — | `references/schema-definition.md` | `SKILL.md § Constraints, § Indexing, § JSONB Guidance` | — | — | — | — | — | — | — |
| 3 | — | — | `references/migrations.md` | `SKILL.md § Safe Schema Evolution` | — | — | — | — | — | — | — |
| 4 | `rules/domain-purity.md`, `rules/tracing.md`, `rules/testing.md` | — | — | — | — | — | — | — | — | — | — |
| 5 | `rules/layers.md`, `rules/ports-and-di.md`, `rules/domain-purity.md`, `rules/tracing.md` | — | — | — | — | — | — | — | — | — | `SKILL.md` |
| 6 | `rules/fastify-transport.md`, `rules/errors.md`, `rules/ports-and-di.md`, `rules/drizzle-persistence.md`, `rules/testing.md` | `rules/routes.md`, `rules/schemas.md`, `rules/testing.md` | `references/transactions.md`, `queries-joins-aggregations.md` | — | `references/parse-validate-early.md` | `SKILL.md`, `checklists.md` | — | — | — | — | — |
| 7 | `rules/layers.md`, `rules/errors.md`, `rules/fastify-transport.md`, `rules/tracing.md` | `rules/routes.md`, `rules/testing.md` | `references/queries-joins-aggregations.md` | — | — | `SKILL.md`, `checklists.md` | — | — | — | — | — |
| 8 | `rules/errors.md`, `rules/drizzle-persistence.md`, `rules/zod-contracts.md` | `rules/schemas.md` | `references/queries-joins-aggregations.md` | — | — | `checklists.md` | — | — | — | — | — |
| 9 | — | — | — | — | — | — | `placement.md`, `devdigest.md` | `SKILL.md § Data Fetching` | — | `SKILL.md § Query Priority` | — |
| 10 | — | — | — | — | — | — | `placement.md` | `SKILL.md § Accessibility, § Derive, Don't Store` | — | `SKILL.md § Query Priority` | — |
| 11 | — | — | — | — | — | — | `placement.md`, `composition.md`, `boundaries.md` | `SKILL.md § Derive, Don't Store, § Key Prop Patterns, § Accessibility` | — | `SKILL.md § Query Priority` | — |
| 12 | — | — | — | — | — | — | `placement.md` | `SKILL.md § Derive, Don't Store, § Conditional Rendering, § Accessibility` | — | `SKILL.md § Query Priority` | — |
| 13 | — | — | — | — | — | — | `devdigest.md`, `placement.md` | `SKILL.md § Data Fetching, § Accessibility` | `async-patterns.md`, `rsc-boundaries.md`, `file-conventions.md` | `SKILL.md § Query Priority` | — |
| 14 | `rules/testing.md` | — | — | — | — | — | — | — | — | — | — |

## 6. Verification

| Package | Command (from the repository root) | Proves |
|---|---|---|
| server | `.claude/agents/scripts/check-code.sh server` | typecheck, `depcruise` (ten rules), the unit lane — AC-35, AC-36, AC-50…AC-59, NFR-1, NFR-4, NFR-7; the existing suites unchanged (NFR-9) |
| server | `.claude/agents/scripts/check-code.sh --it server` (Docker) | the same, then the `.it` lane — AC-1…AC-5, AC-7…AC-12, AC-20, AC-29…AC-34, AC-37…AC-44, AC-64, AC-65, AC-67, AC-70…AC-72, AC-79, AC-80, AC-82, AC-93…AC-95, AC-97, NFR-2, NFR-3, NFR-6, NFR-12, NFR-13 |
| server | `cd server && pnpm verify:l06` | AC-96 (manual ring) |
| server | `server/node_modules/.bin/tsc -p /tmp/tsconfig.eval-tests.json` (stage 15) | the new test files type-check; `pnpm typecheck` skips `test/**` |
| server | `cd server && pnpm exec drizzle-kit generate` → "No schema changes" | the hand-written snapshot equals the schema |
| server | `grep -n "import" server/src/modules/eval/scoring.ts` → nothing | NFR-1 |
| server | `grep -rnE "throw new Error\(" server/src/modules/eval` → nothing | `rules/errors.md` |
| both | `diff -u server/src/vendor/shared/contracts/eval.ts client/src/vendor/shared/contracts/eval.ts` → nothing | NFR-7 |
| both | `diff -u` of the two `eval-ci.ts` → only the three hunks present at `1d4e77f` (import line, `AgentManifest`, `ConformanceInput.provider`) | NFR-7: the difference did not grow |
| client | `.claude/agents/scripts/check-code.sh client` | typecheck, component tests — AC-13…AC-19, AC-21…AC-28, AC-45…AC-49, AC-60…AC-63, AC-66, AC-68, AC-69, AC-73…AC-78, AC-81, AC-83…AC-92, NFR-5, NFR-10, NFR-11 |
| client | `next build` on a copy (stage 15 step 3) | no value import from `@devdigest/shared`; the two routes build |
| client | `grep -rnE ">[A-Z][a-z]+ [a-z]" client/src/components/eval-runs client/src/app/eval "client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab" --include=*.tsx` — read each hit | NFR-10: no literal UI string (hits in tests are expected) |
| mcp | `.claude/agents/scripts/check-code.sh mcp` | NFR-9: the MCP suite passes unchanged |
| repo | `git status --short reviewer-core mcp e2e evals .claude` → nothing from this work | NG-6, NG-7, NG-8, NG-10 |
| dev DB | stage 16 | NFR-8, EC-29 |
| live | stage 17 | G-7, US-9, US-12 on real data |

## 7. Risks and open questions

- [settled 2026-10-12, declared deviation] F1 AC-6: the rule text of the approved criterion stands — the slug is cut to 34 characters, nothing trimmed (as stage 5 builds it); the 33-character string in the criterion's `verify:` hint is a typo of the example, not a second rule. Stage 14 asserts the string the rule produces (`must-find-hardcoded-stripe-secret-key-in-com`) and is no longer waiting.
- F1 as returned: AC-6 [conflict]: the rule and its own example disagree.
  - The rule says "cut to 34 characters". The `verify:` example `must-find-hardcoded-stripe-secret-key-in-co` holds 33 characters after the prefix (`specs/2026-10-12-eval-pipeline.md:101`).
  - The source the criterion cites slices the slug to 34, which gives `…-in-com`, and also strips a leading and a trailing hyphen, which the criterion does not mention (`docs/design/Dev Digest 2/Dev Digest/findings.jsx:33`).
  - Each reading changes one constant, possibly one trim, and the expected string of one unit test.
  - Stage 14 waits for the spec. Stages 5–8 are planned on the criterion's rule text and do not wait.
- [blocking] Execution mode — options: multi-agent / single-agent (question 1).
- [blocking for stage 17 only] The prompt that stays on the subject agent after the experiment — options: restore the baseline text / keep the improved text (question 2).
- [blocking for stage 17 only] A baseline run on an agent version without a snapshot cannot be compared (MI-6 `:280`). Seeded agents get no `agent_versions` row: `server/src/db/seed.ts` inserts `version: 1` and never writes the table; only `AgentsRepository.insert` and `update` do (`server/src/modules/agents/repository.ts:104,146`). Options in question 3.
- [non-blocking] Declared deviation, on the calling session's instruction: `server/package.json` is not `skip-worktree` in this clone (`git ls-files -v server/package.json` prints `H`). The spec's and the brief's wording about the flag is a known inaccuracy. There is no "lift the flag" step; the script line is committed like any other change. The implementer guard still refuses the file, so stage 15 stays with the calling session.
- [non-blocking] `scoring.test.ts` sits beside `scoring.ts` under `server/src/`, on the calling session's instruction for SPEC-08. It is the first test under `server/src/`.
  - `vitest.config.ts` already collects `src/**/*.test.ts`.
  - `tsconfig.json` type-checks it and `tsc -p` would emit it into `dist/`; the project runs `tsx`, so nothing reads that output.
  - If CI's unit lane names `test/` explicitly, add the path there; `.github/workflows/server-unit.yml` was not read.
- [non-blocking] `cases_total` and `cases_passed` of a compare side are computed over the common cases, as the metrics are (AC-72, AC-77). The contract lists the two fields without saying which set; the compare view does not show them (AC-73).
- [non-blocking] `last_result` is read from the 20 newest completed runs of the agent (`EVAL_RUN_LIST_LIMIT`). A run covers every case, so the newest one decides in practice.
- [non-blocking] `POST /findings/:id/eval-case` returns `last_result: null`; the contract table marks the field "on `GET /agents/:id/eval-cases`".
- [non-blocking] A missing version snapshot answers `eval_runs_not_comparable`, per MI-6. AC-71 itself names only "not completed" and "not a run of that agent".
- [non-blocking] The sidebar label is the literal in `client/src/vendor/ui/nav.ts`, as for every other item (`NavItem.tsx:54` renders `item.label`). The stage 9 test holds it equal to `shell.json` `nav.eval`.
- [non-blocking] Agent deletion removes `eval_cases` inside `AgentsRepository.deleteById` (one transaction) and `eval_runs` by FK cascade, instead of a call from the agents service into the eval service. This makes MI-12's "the delete fails as a whole" true. See §8.
- [non-blocking] `sliceDiff` in `reviewer-core` can capture a second file whose path contains the first (`reviewer-core/src/review/reduce.ts:64-65`). The plan does not use it for AC-4; fixing it is outside NG-6.
- [non-blocking] An eval run has no cancel and no per-case deadline. A hung provider call keeps the run `running` until the provider's own timeout or an API restart (AC-42). The spec asks for neither.
- [non-blocking] The rate-limit check of NFR-3 asserts the route's config constant. `NODE_ENV=test` disables the limiter, so a 429 is not exercised.
- [non-blocking] Not checked by me:
  - the dev DB (no psql in this agent) — the counts come from the brief;
  - whether Docker is available to the implementers — the `.it` suites self-skip without it, and each brief must say which lane ran;
  - `.github/workflows/*.yml`.
- [→ researcher] none.
- [→ brainstorm] none.

## 8. Handoff to reviewers

- Architecture:
  - the new consumer-declared ports in `server/src/modules/eval/types.ts`, with `ReviewService` as `EvalFindingSource` (two new read methods);
  - `Container.reviewService` as a new getter next to the `new ReviewService(container)` calls left in `reviews/routes.ts` and `app.ts`;
  - the move of `taskLine` / `renderSkillBlocks` into `server/src/domain/reviews/prompt-parts.ts`, with a re-export from `reviews/helpers.ts`;
  - `AgentsRepository.deleteById` writing `eval_cases`, and the FK `eval_runs.agent_id → agents`;
  - `eval/runner.ts` as orchestration outside `service.ts`;
  - `src/db/eval-fixtures.ts` as a second data-layer CLI;
  - `eval/helpers.ts` importing the pure `adapters/git/diff-parser.ts` (precedent: `reviews/diff-loader.ts:3`);
  - the first test file under `server/src/`.
- Security:
  - eight new routes and the changed `DELETE /agents/:id`; workspace scoping on every one (AC-44);
  - `POST /findings/:id/eval-case` stores server-read data only (NFR-6);
  - author-controlled diff, title and description stored and replayed to a model on every run — only through `assemblePrompt`'s untrusted blocks (UI-1, UI-2, NFR-4); the delimiter gap of NG-11 applies here as it does to a live review;
  - model-written titles and findings and user-written prompts rendered on four screens, as text (UI-3…UI-5, NFR-5);
  - the paid route's rate limit (NFR-3);
  - the log lines of NFR-12;
  - the compare query (UI-6);
  - the jsonb `results` document read back without a per-row parse.

## 9. Execution

Mode: multi-agent — questions 1–3 answered 2026-10-12 with the recommended options (the user's "take all recommended"): multi-agent; after the experiment the baseline prompt is restored; without a snapshot of the baseline version, runs 2 and 3 are the compared pair. REC1 not accepted.
Recommended: multi-agent. After the contracts land, the server and the client tracks share no file. The client then splits into two independent pairs. Each track is several stages of real work.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| shared | 1–2 | both `src/vendor/shared/{contracts/eval.ts,contracts/knowledge.ts,contracts/eval-ci.ts,index.ts}`, `server/test/contracts.test.ts`, `server/test/eval-contracts.test.ts`, `server/src/db/schema/eval.ts` | — | alone |
| calling session | 3 | `server/src/db/migrations/**` | 2 | alone; client stage 9 may start meanwhile |
| server | 4, 5, 6, 7, 8 | `server/src/modules/eval/**`, `server/src/domain/reviews/prompt-parts.ts`, `server/src/modules/reviews/{helpers,service}.ts`, `server/src/modules/agents/repository.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/src/app.ts`, `server/src/db/eval-fixtures.ts`, `server/test/eval-*.ts`, `server/test/helpers/eval.ts` | 3 | parallel with every client track; its own stages in order |
| client | 9 | `client/src/lib/hooks/evals*.ts*`, `client/messages/en/{eval,prReview}.json`, `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/navigation.test.tsx`, `client/src/lib/text-diff*.ts`, `client/src/app/skills/_components/SkillDetail/_components/VersionsTab/**` | 1 | alone inside the client; parallel with stage 3 and the server |
| client-pr | 10 | `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/**` | 9 | parallel with 11 |
| client-runs | 11 | `client/src/components/eval-runs/**` | 9 | parallel with 10 |
| client-tab | 12 | `client/src/app/agents/[id]/_components/AgentEditor/**` | 11 | parallel with 13 |
| client-dash | 13 | `client/src/app/eval/**` | 11 | parallel with 12 |
| server (late) | 14 | `server/test/eval-case-name.test.ts`, `server/src/modules/eval/constants.ts` | 5 and F1 | alone, whenever F1 is settled |
| join (calling session) | 15, 16, 17 | `server/package.json`; the dev DB; `specs/fixtures/eval-pipeline/` | 8, 10, 12, 13 | alone, in order |

What must land first: stage 1 (contracts, both copies) before anything else; stage 2 and stage 3 (schema and migration) before the server track. Message files and the hooks file are written in stage 9 only. A brief of stages 10–13 that finds a key missing reports it and does not edit `eval.json`; the calling session adds the key.

Which briefs may run together: B2 with stage 3; then B3…B7 (server, in order) alongside B8; then B9 ∥ B10; then B11 ∥ B12. At most three implementers run at once (one server, two client).

Briefs — a fresh `implementer` per brief, in order inside a track. Each brief text is followed by the stage's own text, its `Read first` list and its `Skills` line copied from §4.
- B1 · shared · stages 1–2 → "Execute stages 1–2 of specs/2026-10-12-eval-pipeline-plan.md (track shared). Write only inside: server/src/vendor/shared/{contracts/eval.ts,contracts/knowledge.ts,contracts/eval-ci.ts,index.ts}, the same four paths under client/src/vendor/shared, server/test/contracts.test.ts, server/test/eval-contracts.test.ts, server/src/db/schema/eval.ts. Generate no migration. Check with: .claude/agents/scripts/check-code.sh server -- contracts ; .claude/agents/scripts/check-code.sh --no-tests client."
- B2 · client · stage 9 → "Execute stage 9 (track client). Write only inside: client/src/lib/hooks/evals.ts, client/src/lib/hooks/evals.test.tsx, client/messages/en/eval.json, client/messages/en/prReview.json, client/src/vendor/ui/nav.ts, client/src/components/app-shell/navigation.test.tsx, client/src/lib/text-diff.ts, client/src/lib/text-diff.test.ts, client/src/app/skills/_components/SkillDetail/_components/VersionsTab/. Import only types from @devdigest/shared. Check with: .claude/agents/scripts/check-code.sh client -- evals.test navigation.test text-diff.test VersionsTab.test."
- B3 · server · stage 4 → "Execute stage 4 (track server). Write only inside: server/src/modules/eval/scoring.ts, server/src/modules/eval/scoring.test.ts. scoring.ts has no import statement. Check with: .claude/agents/scripts/check-code.sh server -- src/modules/eval/scoring."
- B4 · server · stage 5 → "Execute stage 5 (track server). Write only inside: server/src/domain/reviews/prompt-parts.ts, server/src/modules/reviews/helpers.ts, server/src/modules/eval/{constants,types,helpers}.ts, server/test/eval-helpers.test.ts. Do not assert the AC-6 example string. Check with: .claude/agents/scripts/check-code.sh server -- eval-helpers reviews-helpers skills-extract prompt-structured."
- B5 · server · stage 6 → "Execute stage 6 (track server). Write only inside: server/src/modules/eval/{repository,service,routes}.ts, server/src/modules/index.ts, server/src/modules/reviews/service.ts, server/src/platform/container.ts, server/src/modules/agents/repository.ts, server/test/helpers/eval.ts, server/test/eval-cases.it.test.ts. Check with: .claude/agents/scripts/check-code.sh --it server -- eval-cases.it agents-versions.it reviews.it. Say whether Docker ran the suites."
- B6 · server · stage 7 → "Execute stage 7 (track server). Write only inside: server/src/modules/eval/{runner,repository,service,routes}.ts, server/src/app.ts, server/test/eval-runs.it.test.ts, server/test/helpers/eval.ts. Check with: .claude/agents/scripts/check-code.sh --it server -- eval-runs.it eval-cases.it routes-smoke."
- B7 · server · stage 8 → "Execute stage 8 (track server). Write only inside: server/src/modules/eval/{service,repository,routes,helpers}.ts, server/src/db/eval-fixtures.ts, server/test/eval-compare.it.test.ts. Run the fixture CLI against no database. Check with: .claude/agents/scripts/check-code.sh --it server -- eval-."
- B8 · client-pr · stage 10 → "Execute stage 10 (track client-pr). Write only inside: client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/. Do not edit message files; report a missing key. Check with: .claude/agents/scripts/check-code.sh client -- EvalCaseAction.test FindingCard.test FindingsPanel.test."
- B9 · client-runs · stage 11 → "Execute stage 11 (track client-runs). Write only inside: client/src/components/eval-runs/. Do not edit message files; report a missing key. Check with: .claude/agents/scripts/check-code.sh client -- eval-runs."
- B10 · client-tab · stage 12 → "Execute stage 12 (track client-tab). Write only inside: client/src/app/agents/[id]/_components/AgentEditor/. Do not edit message files or client/src/components/eval-runs/. Check with: .claude/agents/scripts/check-code.sh client -- EvalsTab.test CaseList.test AgentEditor.test."
- B11 · client-dash · stage 13 → "Execute stage 13 (track client-dash). Write only inside: client/src/app/eval/. Do not edit message files or client/src/components/eval-runs/. Check with: .claude/agents/scripts/check-code.sh client -- EvalDashboard.test AgentEvalView.test."
- B12 · server (late) · stage 14 → "Execute stage 14 (track server), with AC-6 as settled in <spec path>. Write only inside: server/test/eval-case-name.test.ts, server/src/modules/eval/constants.ts. Check with: .claude/agents/scripts/check-code.sh server -- eval-case-name."
- Calling session: stage 3 after B1; stages 15, 16, 17 after B7, B8, B10, B11.

single-agent: the same briefs, one after another — B1, stage 3, B3, B4, B5, B6, B7, B2, B8, B9, B10, B11, B12, then 15, 16, 17. The Runs column is not used.

The user's steps: the commit and the PR; the video of NG-13; `/pr-self-review` and `/workflow-retro` if wanted. There is no skip-worktree step.

## 10. Recommendations — not applied

- REC1 [requirements] Store the system prompt with each run at start, as AC-67 already does for provider, model and skill names, and read the compare view's prompts from the runs.
  - Why: AC-70 reads the prompt "from that version's stored snapshot", and seeded agents have no snapshot for version 1 (`server/src/db/seed.ts` writes no `agent_versions` row; `server/src/modules/agents/repository.ts:104,146` are the only writers). The first comparison that involves an untouched seeded agent's baseline answers 400.
  - Would change: AC-70, MI-6, one column in stages 2 and 3, `compareRuns` in stage 8, and the snapshot check of stage 17. It needs a superseding spec.
  - My recommendation: do not take it for this build. Question 3 covers the experiment; raise it with SPEC-04 or SPEC-05, which revisit the run record anyway.

## Questions for the user
The calling session asks these with AskUserQuestion and sends the answers back; the implementer does not start before every [blocking] one is answered. By the user's delegation for this homework the recommended option is taken for each.
1. [blocking] Execution mode — multi-agent or single-agent?
   - multi-agent (recommended) — after stage 1 the server track (stages 4–8) and the client tracks (9, then 10 ∥ 11, then 12 ∥ 13) have disjoint write sets; at most three implementers run at once; the calling session writes the migration (stage 3) while the client starts.
   - single-agent — the same twelve briefs one after another; no merge risk; roughly twice the wall-clock time.
2. [blocking for stage 17] After the experiment, which system prompt stays on Test Quality Reviewer?
   - restore the baseline text (recommended) — reviews behave as before the experiment; costs one more agent version (additive rows only).
   - keep the improved text — only if run 2 scored better than run 1 on both recall and precision; the user's reviews change from then on.
3. [blocking for stage 17] If the subject's current agent version has no `agent_versions` snapshot (stage 17 step 2 reads it), how is the baseline made comparable?
   - compare runs 2 and 3 only, improved → broken (recommended) — no extra write; it shows exactly what the homework asks ("a deliberately broken prompt shows as a lower precision"); the baseline run still appears in the history and the tiles.
   - save a description-only edit before run 1 — creates a snapshot of the unchanged prompt so runs 1 and 2 compare too; changes the agent's description text and adds a version.
Recommendations awaiting a decision: REC1 (section 10) — recommended answer: not now; the plan stands as written.
Gaps for `spec-creator`, not questions of mine: F1 (section 7) — it settles AC-6 with the user in a spec; stage 14 waits until then, no other stage does.
