# Implementation Plan — Case Editor (SPEC-04)
Source: `specs/2026-10-12-case-editor.md` (SPEC-04, `Status: approved`, `check-spec.sh` ok, 0 open questions) · Base: `1d4e77f` plus the uncommitted SPEC-03 work in the tree · Packages: server, client (contracts in both `vendor/shared` copies)

**Precondition for every stage:** SPEC-03 stages 1–15 of `specs/2026-10-12-eval-pipeline-plan.md` are done and green. I read as code: the contracts, the schema, migration `0017`, `server/src/modules/eval/{constants,types,helpers,repository,service,routes,scoring}.ts`, `client/src/lib/hooks/evals.ts`, `client/messages/en/eval.json`, `client/src/components/eval-runs/**`, `EvalsTab.tsx`, `CaseList.tsx`. Not in the tree when I read: `eval/runner.ts`, the run and compare halves of `service.ts` / `routes.ts`, `eval-runs.it` / `eval-compare.it` tests, `AgentEvalView.test.tsx`. For those the source is the SPEC-03 plan stage named in the step, marked "verify at implementation time".

## 0. Before the first edit

INSIGHTS that shape this plan:
- `INSIGHTS.md § What Works` — "Any write to the dev DB goes through a dry run on a restored copy" and its correction of 2026-09-24 → stage 12 is that recipe; the dump is kept until the user has looked.
- `INSIGHTS.md § What Works` — "To prove a screen made no model call…" → NFR-1 is asserted on `MockLLMProvider.calls` and on the fetch mock, not on logs.
- `INSIGHTS.md § What Doesn't Work` — "An implementer's token bill is turns × standing context" → no brief holds more than two stages.
- `INSIGHTS.md § What Doesn't Work` — "`git grep` passes vacuously for an untracked module" and "A plan's absence check on generic words" → every absence check here is `grep -rn` on an identifier only this feature removes.
- `INSIGHTS.md § What Doesn't Work` — "pr-self-review runs no drizzle/postgres lane on a table edit" → stage 1 applies `drizzle-orm-patterns` and `postgresql-table-design` to `schema/eval.ts` deliberately.
- `INSIGHTS.md § Codebase Patterns` — "The starter pre-wires a course lesson" → found pre-wired: `EvalCaseInput` (`{server,client}/src/vendor/shared/contracts/eval-ci.ts:20`, no consumer), `caseEditor.*`, `evalsTab.edit`, `evalsTab.newCase`, `page.crumbNewCase` (`client/messages/en/eval.json:40-66,71,80,102`), and the empty actions slot in `CaseList.tsx`. The plan extends these and adds no second namespace or payload type.
- `INSIGHTS.md § Tool & Library Notes` — "pnpm 12.4.2 exits non-zero… AFTER doing the work" → tools are called from `node_modules/.bin`.
- `INSIGHTS.md § Tool & Library Notes` — "A long subagent result reaches the calling session cut and HTML-escaped" → save this plan from the agent transcript, not from the notification.
- `server/INSIGHTS.md § Tool & Library Notes` — "`drizzle-kit generate` becomes INTERACTIVE the moment one migration both drops and adds columns" → `0018` adds one column and drops nothing, so it is generated (stage 3).
- `server/INSIGHTS.md § Tool & Library Notes` — "`pnpm typecheck` does not look at `test/**`", and `§ Recurring Errors` — the `/tmp` tsconfig with `typeRoots`, run by the calling session → stage 11.
- `server/INSIGHTS.md § Recurring Errors` — "`Property 'statusCode' does not exist…`" → an inject helper's payload is typed `Record<string, unknown>`.
- `server/INSIGHTS.md § Codebase Patterns` — "A derived count belongs on the DTO… filled on EVERY read path" → `revision` and `last_result` are filled on POST, PUT and the list.
- `server/INSIGHTS.md § Codebase Patterns` — "`findings.severity` is a free-text column" → a finding-born case can hold a severity or category outside the enums (§7, REC1).
- `server/INSIGHTS.md § Codebase Patterns` — "`wrapUntrusted` closes a block against the exact string `</untrusted>` only" → NG-5; the AC-25 test asserts placement and makes no claim about a forged tag.
- `server/INSIGHTS.md § Tool & Library Notes` — "`tsx watch` does not restart… under `src/vendor/`" → matters for the dev stack (§7).
- `client/INSIGHTS.md § Recurring Errors` — "The client's vendored `@devdigest/shared` is a TYPE-only dependency" → severity and category options are local tuples with an `Exclude` guard; `next build` on a copy is stage 11.
- `client/INSIGHTS.md § Tool & Library Notes` — `Tabs` renders plain buttons; a `Modal` renders inline, so a nested confirm gives two `role="dialog"`; no `user-event`; client typecheck covers tests with `noUncheckedIndexedAccess`; a vitest filter is a file-name fragment, never an escaped `[id]` path.
- `client/INSIGHTS.md § Recurring Errors` — "A vitest hook that RETURNS a function…" → block bodies in `beforeEach`.
- `client/INSIGHTS.md § Codebase Patterns` — "A helper two sibling `_components/` folders share moves to… the nearest common parent" → `expectedCount` moves to `EvalsTab/helpers.ts` (stage 8).

Read: `specs/2026-10-12-case-editor.md`; `specs/2026-10-12-eval-pipeline-plan.md` §3 and stages 7, 8, 15, 16; `client/specs/2026-10-12-eval-trend-charts-plan.md` §2, §9; `docs/design/Dev Digest 2/Dev Digest/screen_cizruns.jsx:55-104`.

## 1. Scope — as the source states it

All pointers are lines of `specs/2026-10-12-case-editor.md`.

Goals:
- G-1 "An agent author creates an eval case for an agent by hand…with no finding behind it." — `:35`
- G-2 "An agent author edits an existing case of an agent's set, whatever its origin." — `:36`
- G-3 "An agent author sees the pasted diff rendered by the product's diff viewer before saving the case." — `:37`
- G-4 "A hand-made case lives in the same set as a finding-born one, is executed by the same run route and is scored by the same rules." — `:38`
- G-5 "Editing a case leaves every stored run reporting what it scored at the time." — `:39`

Non-goals: NG-1…NG-9 — `:41-49`. In short, in the source's words: no change to SPEC-03 "beyond the additions listed under Contracts"; no skill-owned cases; no "history of a case's earlier content"; no MCP tool, no e2e flow; not "closing the two known gaps of the live review prompt"; no "Run case", "Run on save", row run icon, duration or cost; no "Files" tab, "Linked issue", notes; no free JSON editor; no fragment "that has no `---` / `+++` file lines".

Acceptance criteria:
- AC-1 "`POST /agents/:id/eval-cases`…store one case…`owner_kind` `agent`, `source_finding_id` null and `revision` 1, and answer 201" — `:71` — clear
- AC-2 "store the request's `input_diff` byte for byte and, in `input_files`, the path of every file the diff names, in the diff's order" — `:72` — clear; see §7 on a multi-file text without `diff --git` lines
- AC-3 "`pr_title` and `pr_body`, and null for `pr_number` and `pr_author`" — `:73` — clear
- AC-4 "an empty string for each of the last three that the request leaves out" — `:74` — clear
- AC-5 "IF the body fails the route's schema…422 and store nothing" — `:75` — clear
- AC-6 "holds no file with at least one hunk…400 with code `eval_diff_invalid`" — `:76` — clear
- AC-7 "`file` is not a file of `input_diff`, or its line range shares no line with a hunk of that file…400…`expectation_outside_diff`" — `:77` — clear; the check exists as `expectationInsideDiff` (`server/src/modules/eval/helpers.ts:70`)
- AC-8 "agent…does not exist or belongs to another workspace…404" — `:78` — clear
- AC-9 "larger than the API's body limit of 1,048,576 bytes…refuse the request and store nothing" — `:79` — already there `server/src/app.ts:49`; test only
- AC-10 "`PUT /eval-cases/:id`…replace the case's `name`, `input_diff`, `input_files`, the `pr_title` and `pr_body`…and `expected_output`…answer 200" — `:83` — clear
- AC-11 "leave a case's `id`, `owner_id`, `expectation_type`, `source_finding_id`, `created_at` and the `pr_number` and `pr_author`…unchanged…whatever the body carries" — `:84` — clear
- AC-12 "fails a rule of AC-5, AC-6, AC-7 or AC-9…the status and code that rule names and leave the case unchanged" — `:85` — clear
- AC-13 "case…does not exist or belongs to another workspace…404" — `:86` — clear
- AC-14 "WHILE a run of the case's agent is in status `running`…400 with code `eval_run_in_progress`" — `:87` — clear; `findRunningRun` exists (`repository.ts`)
- AC-15 "increase a case's `revision` by 1 on an update that changes the case's content, and on no other update" — `:91` — clear (content defined at `:63-66`)
- AC-16 "leave every stored run unchanged" — `:92` — clear; holds by construction (a run stores its outcomes), test only
- AC-17 "store with each per-case outcome of a run the `case_revision` the execution used" — `:93` — clear
- AC-18 "`last_result` the outcome of the newest completed run that covered the case at its current `revision`, or null" — `:94` — clear
- AC-19 "compute the metrics of both runs without that case…and name the case in `cases_edited`" — `:95` — clear
- AC-20 "the compare view shall say that the case was edited between the two runs and is left out of the values, and name it" — `:96` — clear
- AC-21 "read a case stored without a revision as `revision` 1 and a per-case outcome stored without one as `case_revision` 1" — `:97` — clear
- AC-22 "return both in the one list, in the one record shape" — `:101` — follows from AC-1 and `listCasesForAgent`; test only
- AC-23 "cover both in the run's `case_ids` and record an outcome for each" — `:102` — SPEC-03 stage 7 runs every case of the agent (verify at implementation time); test only
- AC-24 "task line…from the case's `pr_title` alone, naming no pull request number and no author" — `:103` — clear
- AC-25 "only inside the engine's untrusted-data blocks of the user message, and never in the system message" — `:104` — already there through `buildCaseReviewInput` (`helpers.ts:102`); test only
- AC-26 "a \"New eval case\" control beside the run control, also while the agent has no case" — `:108` — clear
- AC-27 "on every case row…an edit control whose accessible name names the case" — `:109` — clear
- AC-28 "a dialog titled \"New eval case\" that names the agent, with an empty name, an empty diff and the expectation type `must_find` selected" — `:110` — clear
- AC-29 "titled \"Eval case · \" followed by the case's name, holding that case's name, diff, pull request title and body, and expectation values" — `:111` — clear
- AC-30 "a required Name field, an Input area with the tabs \"Diff\" and \"PR meta\"…\"must find\" and \"must NOT flag\"…and no JSON text" — `:112` — clear
- AC-31 "show the expectation type as text that is not editable" — `:113` — clear
- AC-32 "a preview…rendered by the product's diff viewer — one card per file, with line numbers, and without comment controls" — `:114` — clear
- AC-33 "a message that the text is not a unified diff" — `:115` — clear
- AC-34 "WHILE the name, the diff or the file is empty, or the two line numbers do not form a range that starts at 1 or above…Save disabled" — `:116` — clear
- AC-35 "one `POST`…or one `PUT`…with the form's values" — `:117` — clear
- AC-36 "Save disabled with the text \"Saving…\"" — `:118` — clear
- AC-37 "show the saved case's row in the list, with the editor closed, without a page reload" — `:119` — clear
- AC-38 "stay open with every field's value kept and show the API's message" — `:120` — clear
- AC-39 "\"Last run passed\" or \"Last run failed\" with \"expected N, got M\", or the error of an errored result, as the case's row states it" — `:121` — clear
- AC-40 "ask for confirmation before it discards the changes" — `:122` — clear
- AC-41 "render with the case editor closed, whatever was open before the load" — `:123` — holds by construction (local state); test only
- AC-42 "a choice among the files of the diff field's current text, with the file selected…when the text holds exactly one file" — `:124` — clear
- AC-43 "mark in the preview the lines of the chosen file that fall inside the range, by a marker in addition to colour" — `:125` — clear; the diff viewer has no range marker today (`DiffViewer.tsx:16-26`), stage 7 adds one
- AC-44 "the chosen file is no longer among its files…clear the file choice" — `:126` — clear; composes with AC-42 (§7)

Edge cases EC-1…EC-20 — `:130-149` — each is covered by the criterion it names.

Non-functional: NFR-1 [cost] `:153` · NFR-2 [security] `:154` · NFR-3 [security] `:155` · NFR-4 [compatibility] "declared in both `@devdigest/shared` copies with identical text" `:156` · NFR-5 [compatibility] "new migration files that only add…the dev database is written only after a dry run on a restored copy" `:157` · NFR-6 [compatibility] `:158` · NFR-7 [i18n] `:159` · NFR-8 [accessibility] `:160` — all clear.

Contracts: `:201-246`. Findings against the code: none that needs `spec-creator`. Three readings I made are stated in §7.

## 2. Impact map

| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| both | `{server,client}/src/vendor/shared/contracts/eval.ts` | Modify, byte-identical | wire contract | NFR-4, `:201-232` |
| both | `{server,client}/src/vendor/shared/contracts/eval-ci.ts` | Modify — remove the unused `EvalCaseInput` | wire contract | NFR-4 |
| server | `server/src/db/schema/eval.ts` | Modify — `revision` column, two `$type` widenings | persistence schema | AC-1, 15, 17, 21 |
| server | `server/test/eval-contracts.test.ts` | Modify | hermetic test | NFR-4 |
| client | `client/src/lib/hooks/evals.test.tsx`, `…/EvalsTab/EvalsTab.test.tsx`, `…/CaseList/CaseList.test.tsx`, `client/src/components/eval-runs/RunHistory/RunHistory.test.tsx`, `…/CompareRunsDialog/CompareRunsDialog.test.tsx`, `client/src/app/eval/[agentId]/_components/AgentEvalView/helpers.test.ts`, `AgentEvalView.test.tsx` (after SPEC-03 stage 13), `…/EvalCaseAction/EvalCaseAction.test.tsx` | Modify — typed fixtures gain the new required fields, nothing else | tests | NFR-4 |
| server | `server/src/domain/reviews/prompt-parts.ts` | Modify — the rule tail becomes a shared constant; one new function | domain | AC-24 |
| server | `server/src/modules/eval/{types,helpers,repository,constants}.ts` | Modify | ports, pure, driven adapter | AC-2…7, 15, 17…19, 21, 24 |
| server | `server/src/modules/eval/{service,routes}.ts` | Modify | application, driving adapter | AC-1…16, 18, 19 |
| server | `server/src/modules/eval/runner.ts` | Modify (after SPEC-03 stage 7) — one field | application | AC-17 |
| server | `server/test/eval-case-editor.test.ts` | New | hermetic test | AC-18, 19, 21, 24, 25 |
| server | `server/src/db/migrations/0018_eval_case_revision.sql`, `meta/0018_snapshot.json`, `meta/_journal.json` | New / New / Modify — calling session, generated | migration | NFR-5 |
| server | `server/test/eval-case-create.it.test.ts` | New | DB-backed test | AC-1…9, 22, NFR-1, NFR-2 |
| server | `server/test/eval-case-update.it.test.ts` | New | DB-backed test | AC-10…19, 21, 23 |
| server | `server/test/helpers/eval.ts` | Modify — helpers appended | test helper | — |
| client | `client/messages/en/eval.json` | Modify — keys inside `caseEditor`, `runs.compare` | copy | NFR-7 |
| client | `client/src/lib/hooks/evals.ts`, `evals.test.tsx` | Modify — two mutations | data access | MI-1, MI-2, AC-35, 37 |
| client | `client/src/components/diff-viewer/{DiffViewer/DiffViewer.tsx,FileCard/FileCard.tsx,CodeLine/CodeLine.tsx,styles.ts,index.ts}` | Modify — one optional prop | cross-route component | AC-43 |
| client | `client/src/components/diff-viewer/DiffViewer/DiffViewer.test.tsx` | New | component test | AC-43, NFR-3 |
| client | `…/EvalsTab/helpers.ts` (+ `helpers.test.ts`) | New — `expectedCount` moves here from `CaseList/helpers.ts` | common parent of two siblings | AC-39 |
| client | `…/EvalsTab/_components/CaseList/{helpers.ts,CaseList.tsx,CaseList.test.tsx}` | Modify | route-local | AC-26, 27 |
| client | `…/EvalsTab/_components/CaseEditorDialog/{CaseEditorDialog.tsx,CaseEditorDialog.test.tsx,helpers.ts,helpers.test.ts,constants.ts,styles.ts,index.ts}` | New | owned by `EvalsTab` | AC-28…44, NFR-1, 3, 7, 8 |
| client | `…/EvalsTab/EvalsTab.tsx`, `EvalsTab.test.tsx` | Modify | route-local | AC-26, 27, 37, 41 |
| client | `client/src/components/eval-runs/RunHistory/_components/CompareRunsDialog/{CompareRunsDialog.tsx,CompareRunsDialog.test.tsx}` | Modify — one notice | shared component | AC-20 |

`…/EvalsTab/` stands for `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/`.

Not touched: `reviewer-core/**`, `mcp/**`, `e2e/**`, `evals/**`, `.claude/**`, lockfiles, `.env*`, `server/package.json` (the `verify:l06` pattern already matches the new files), `server/src/adapters/**`, `client/src/vendor/ui/**`, `client/src/components/eval-runs/{index.ts,helpers.ts,MetricTiles/**}`, `AgentEvalView.tsx`.

Files this plan shares with the SPEC-05 plan (`client/specs/2026-10-12-eval-trend-charts-plan.md`): `client/messages/en/eval.json` (stage 6 here, its B1), `EvalsTab.tsx` and `EvalsTab.test.tsx` (stages 1 and 10 here, its B3), `AgentEvalView.test.tsx` (stage 1 here, fixtures only; its B3). This plan does not write `eval-runs/index.ts`, `eval-runs/helpers.ts`, `MetricTiles/**`, `RunHistory.tsx` or `AgentEvalView.tsx`. Two briefs that write the same file never run at the same time (§9).

## 3. Constraints in play

- dependency-cruiser stays green. The rules this change can trip:
  - `no-cross-module-internals` — the title-only task line is built in `src/domain/reviews/prompt-parts.ts`, not imported from `modules/reviews`.
  - `drizzle-only-in-repositories`, `schema-only-in-repositories` — the update SQL lives in `eval/repository.ts`.
  - `no-row-types-in-transport`, `no-service-to-container`, `no-domain-to-infra`.
- Contracts: `contracts/eval.ts` is byte-identical in both copies (`server/test/eval-contracts.test.ts` holds it). `eval-ci.ts` already differs between the copies; its `diff -u` must not grow.
- Migration: `0018` is generated by `drizzle-kit generate --name eval_case_revision`, by the calling session (an implementer may not write under `server/src/db/migrations/`). One additive column with a constant default. No applied file is edited.
- `./scripts/dev.sh` runs `pnpm db:migrate` on every start (`scripts/dev.sh:84`). Once `0018` exists, a dev-stack start applies it without a dry run. No start between stage 3 and stage 12.
- `input_diff` is never trimmed or normalised (AC-2). `name` is trimmed by its schema.
- The two request schemas strip unknown keys and are not `.strict()` (AC-11: "whatever the body carries").
- `POST /findings/:id/eval-case` keeps no body schema (NFR-6). `reviewer-core/` is not modified.
- Client: `import type` only from `@devdigest/shared`; no `fetch` in components; every string from `client/messages/en/eval.json`; `fireEvent` only.
- New server test files are named `server/test/eval-case-*.ts`, so `verify:l06` (`vitest run src/modules/eval/ test/eval-`, SPEC-03 stage 15) picks them up with no change to `server/package.json`.
- Only stage 6 writes `client/messages/en/*.json`. A later brief that misses a key reports it; the calling session adds it.

## 4. Stages

### Stage 1 — Contracts in both copies, the schema column, typed fixtures
Track: shared · After: SPEC-03 stages 1–15
Files: both `contracts/eval.ts`, both `contracts/eval-ci.ts`, `server/src/db/schema/eval.ts`, `server/test/eval-contracts.test.ts`, the client test files of §2 row 5
Read first: `specs/2026-10-12-case-editor.md:201-246` — the contract tables; `server/src/vendor/shared/contracts/eval.ts` — the file to amend; `server/src/vendor/shared/contracts/eval-ci.ts:17-30` — the reserved payload; `server/src/vendor/shared/contracts/findings.ts:11-15` — `Severity`, `FindingCategory`; `server/src/db/schema/eval.ts:19-75` — the types and the table; `server/test/eval-contracts.test.ts` — fixtures to extend; `server/src/modules/skills/routes.ts:36-47` — the 1–64 name rule.
Steps:
1. In `contracts/eval.ts` (server copy), import `Severity` and `FindingCategory` from `./findings.js` and amend:
   - `EvalInputMeta.pr_number` → `z.number().int().nullable()`; `pr_author` → `z.string().nullable()`.
   - `EvalCase` gains `revision: z.number().int().min(1)`.
   - `EvalCaseOutcome` gains `case_revision: z.number().int().min(1)`.
   - `EvalRunCompare` gains `cases_edited: z.array(z.string())`.
2. In the same file add, each with a same-name type export:
   - a file-local `NotBlank = z.string().refine((v) => v.trim().length > 0)`;
   - `EvalCaseExpectationInput` = `z.object({ file: NotBlank, start_line: z.number().int().min(1), end_line: z.number().int(), title: z.string().default(''), severity: z.union([Severity, z.literal('')]).default(''), category: z.union([FindingCategory, z.literal('')]).default('') }).refine((v) => v.end_line >= v.start_line, { path: ['end_line'] })`;
   - `EvalCaseUpdateInput` = `z.object({ name: z.string().trim().min(1).max(64), input_diff: NotBlank, input_meta: z.object({ pr_title: z.string().default(''), pr_body: z.string().nullable() }), expected_output: EvalCaseExpectationInput })`;
   - `EvalCaseCreateInput` = `EvalCaseUpdateInput.extend({ expectation_type: EvalExpectationType })`.
3. Copy the file byte for byte into the client copy.
4. In both `eval-ci.ts`: delete `EvalCaseInput` and its type (no consumer: `grep -rn "EvalCaseInput" server/src client/src mcp/src reviewer-core/src` matches only the two declarations). Change nothing else there.
5. `server/src/db/schema/eval.ts`:
   - the local `EvalInputMeta` type: `pr_number: number | null`, `pr_author: string | null`;
   - the local `EvalRunOutcome` type: `case_revision?: number` (absent on rows written before this feature);
   - `evalCases`: `revision: integer('revision').notNull().default(1)`.
6. `server/test/eval-contracts.test.ts`: the existing fixtures gain `revision: 1`, `case_revision: 1`, `cases_edited: []`. Add:
   - a case with `pr_number: null` and `pr_author: null` parses;
   - `EvalCaseCreateInput` with the three required expectation values alone parses to three empty strings;
   - a blank `name` and an `end_line` below `start_line` are rejected;
   - neither `eval-ci.ts` copy contains `EvalCaseInput`.
7. Client fixtures: run the client typecheck and add `revision: 1` to every typed `EvalCase` fixture, `case_revision: 1` to every outcome fixture, `cases_edited: []` to every compare fixture. No assertion changes.
Skills: `zod` → `references/object-strict-vs-strip.md` (strip on purpose), `references/refine-add-path.md`, `references/object-extend-for-composition.md`, `references/refine-defaults.md`, `references/object-optional-vs-nullable.md`. `onion-architecture` → `rules/zod-contracts.md § Both copies must change`, `rules/testing.md`. `drizzle-orm-patterns` → `references/schema-definition.md`. `postgresql-table-design` → `SKILL.md § Safe Schema Evolution` — a non-volatile default does not rewrite the table. `react-testing-library` → `SKILL.md § What to Test / What to Skip` (fixtures only).
Tests to add: the cases of step 6 — NFR-4.
Done when: `diff -u server/src/vendor/shared/contracts/eval.ts client/src/vendor/shared/contracts/eval.ts` prints nothing; `.claude/agents/scripts/check-code.sh client` is green; in `.claude/agents/scripts/check-code.sh server -- eval-contracts` the test step is green. The server typecheck step is expected red inside `server/src/modules/eval/` only; the errors printed are stage 2's worklist. No migration is generated here.

### Stage 2 — Revision and the nullable pull request values in the eval module's core
Track: shared · After: 1
Files: `server/src/domain/reviews/prompt-parts.ts`, `server/src/modules/eval/{types,helpers,repository,service}.ts`, `server/src/modules/eval/runner.ts`, `server/test/eval-case-editor.test.ts` (New)
Read first: `server/src/modules/eval/types.ts:18-60,120-130` — `StoredInputMeta`, `StoredCase`, `NewCase`, `StoredOutcome`, `DoneRunCoverage`; `server/src/modules/eval/helpers.ts:88-264` — `caseTaskLine`, `buildCaseReviewInput`, `toCaseDto`, `toOutcomeDto`, `lastResultFor`, `compareSides`; `server/src/modules/eval/repository.ts:80-135,190-225` — the row mappers and `insertCase`; `server/src/modules/eval/service.ts` — the three `toCaseDto` call sites and (after SPEC-03 stage 8) `compareRuns`; `server/src/modules/eval/runner.ts` — where a `StoredOutcome` is built; `server/src/domain/reviews/prompt-parts.ts:1-20`; `server/test/eval-helpers.test.ts:1-80` — how a test reads the assembled messages.
Steps:
1. `prompt-parts.ts`: move the fixed sentences after the first one into a module constant and build `taskLine` from it, so its output is unchanged character for character. Add `titleOnlyTaskLine(title: string)`: `Review pull request "${title}". ` followed by the same constant.
2. `types.ts`: `StoredInputMeta.prNumber: number | null`, `prAuthor: string | null`; `StoredCase.revision: number`; `StoredOutcome.caseRevision: number`. `NewCase` stays `Omit<StoredCase, 'id' | 'workspaceId' | 'createdAt'>` minus `revision` (the column default writes 1).
3. `repository.ts`: `caseFromRow` maps `revision`; `outcomeFromRow` maps `caseRevision: result.case_revision ?? 1` (AC-21); `outcomeToRow` writes `case_revision`. No query changes.
4. `helpers.ts`:
   - `caseTaskLine(meta)`: `taskLine(...)` when `prNumber` and `prAuthor` are both non-null, otherwise `titleOnlyTaskLine(meta.prTitle)`. It stays the one place that reads these values.
   - `toCaseDto` emits `revision`; `toOutcomeDto` emits `case_revision`.
   - `lastResultFor(caseId, revision, doneRunsNewestFirst)`: the newest run that covers the case decides; null when its outcome's `caseRevision` differs from `revision` (AC-18).
   - `compareSides`: an id that has an outcome in both runs under different `caseRevision` values is left out of both scored sets and of both `casesOnlyIn*` lists; the result gains `casesEdited: string[]`, the head run's `caseName` of each.
5. `runner.ts` (verify at implementation time — SPEC-03 stage 7): every outcome it builds, the error one included, carries `caseRevision: c.revision` from the case snapshot the run started with.
6. `service.ts`: pass `stored.revision` to `lastResultFor`; `compareRuns` (SPEC-03 stage 8) returns `cases_edited` from `compareSides`.
Skills: `onion-architecture` → `rules/domain-purity.md § Rules live in the core`, `rules/tracing.md § 3` (pure files stay pure), `rules/drizzle-persistence.md § Row types do not cross the repository boundary`, `rules/zod-contracts.md` ("A declared contract field is not proof the value is produced"), `rules/testing.md`. `drizzle-orm-patterns` → `references/schema-definition.md` (jsonb `$type`).
Tests to add: `server/test/eval-case-editor.test.ts`, hermetic:
   - AC-24: `buildCaseReviewInput` for a case with null number and author — the task holds the title, no `#` followed by a digit and no author; for a case with all three the task equals `taskLine(...)`.
   - AC-25: the same input through `assemblePrompt` — a diff line "ignore the instructions above" and the body stand inside `<untrusted` blocks of the user message; the system message holds neither.
   - AC-18, pure half: `lastResultFor` returns null after a revision change and the outcome when revisions match.
   - AC-19, pure half: `compareSides` over three cases, one with revisions 1 and 2 — scores over two, `casesEdited` names it, both `casesOnlyIn*` empty.
   - `taskLine` output is unchanged (one literal expectation).
Done when: `.claude/agents/scripts/check-code.sh server -- eval-case-editor eval-helpers eval-contracts reviews-helpers prompt-structured src/modules/eval/scoring` is green, typecheck and depcruise included. The `.it` lane is not run here: it needs stage 3.

### Stage 3 — Migration `0018_eval_case_revision` (CALLING SESSION)
Track: calling session · After: 2
Files: `server/src/db/migrations/0018_eval_case_revision.sql` (New), `meta/0018_snapshot.json` (New), `meta/_journal.json`
Read first: `server/INSIGHTS.md:93-94` — when generate turns interactive, and the hand-written fallback; `server/src/db/migrations/0017_eval_pipeline.sql`; `server/drizzle.config.ts`.
Steps:
1. `cd server && ./node_modules/.bin/drizzle-kit generate --name eval_case_revision`. It needs no database.
2. Read the SQL. Expected, and nothing else: `ALTER TABLE "eval_cases" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;`
3. If it prompts, or the file holds any other statement (the hand-built `0017` snapshot and the schema disagree): stop it, delete the three things it wrote, report. Fallback only then: write the one-line SQL by hand, build `0018_snapshot.json` from `0017_snapshot.json` (`prevId` `c6166dde-b762-4039-baa5-736418d3bf40`, a fresh `id`, the one column added to `public.eval_cases`), append the journal entry.
4. Run `./node_modules/.bin/drizzle-kit generate` again. Expected: `No schema changes, nothing to migrate`.
5. `.claude/agents/scripts/check-code.sh --it server -- eval-` — the SPEC-03 `.it` suites pass against a container migrated with `0018` (NFR-6). A suite that fails only on an exact-equality assertion over a body that gained an additive field is reported, not edited (§7).
Skills: `drizzle-orm-patterns` → `references/migrations.md § Migration Best Practices` (review the generated file; never modify an applied one). `postgresql-table-design` → `SKILL.md § Safe Schema Evolution`.
Tests to add: none.
Done when: step 4 prints "No schema changes"; `git status --short server/src/db/migrations` shows two new files and `_journal.json`; step 5 is green with Docker having run the suites.

### Stage 4 — Create a case by hand
Track: server · After: 3
Files: `server/src/modules/eval/{constants,helpers,service,routes}.ts`, `server/test/helpers/eval.ts`, `server/test/eval-case-create.it.test.ts` (New)
Read first: `server/src/modules/eval/service.ts` — `createCaseFromFinding` as the pattern; `server/src/modules/eval/routes.ts`; `server/src/modules/eval/helpers.ts:48-86,102-120` — `extractFileDiff`, `expectationInsideDiff`, `buildCaseReviewInput`; `server/src/modules/eval/repository.ts:190-225` — `insertCase` returns the row for a null `sourceFindingId`; `server/src/adapters/git/diff-parser.ts` — a second `+++ ` line without a `diff --git` line overwrites the current file's path (`:40-45`); `reviewer-core/src/grounding.ts:23-80`; `server/test/eval-cases.it.test.ts:1-90` and `server/test/helpers/eval.ts` — app, mocks, agent helpers; `server/src/app.ts:46-50,120-135` — body limit, 422 mapping.
Steps:
1. `constants.ts`: add `diffInvalid: 'eval_diff_invalid'` to `EVAL_ERROR`.
2. `helpers.ts`:
   - `parseCaseDiff(raw: string): UnifiedDiff`. With a line starting `diff --git ` in the text: `parseUnifiedDiff(raw)`. Without one: cut the text at every line starting `--- ` that is directly followed by a line starting `+++ `, parse each piece with `parseUnifiedDiff`, concatenate `files`, keep `raw` as given.
   - `caseDiffFiles(diff)`: `diff.files.map((f) => f.path)`.
   - `hasHunk(diff)`: some file has at least one hunk.
   - `buildCaseReviewInput` uses `parseCaseDiff(c.inputDiff)` — identical output for a finding-born one-file diff.
3. `service.createCase(workspaceId, agentId, input: EvalCaseCreateInput)`, in this order:
   - agent missing → `NotFoundError('Agent not found')` (AC-8);
   - `!hasHunk(parseCaseDiff(input.input_diff))` → `AppError(EVAL_ERROR.diffInvalid, <message saying a unified diff needs ---/+++ file lines and an @@ hunk>, 400)` (AC-6, US-6);
   - `!expectationInsideDiff(diff, { file, startLine, endLine })` → `AppError(EVAL_ERROR.expectationOutsideDiff, <message naming file and lines>, 400)` (AC-7);
   - `store.insertCase` with `ownerKind: 'agent'`, the name, the type, the six expectation values, `inputDiff` as received, `inputFiles: caseDiffFiles(diff)`, `inputMeta: { prNumber: null, prTitle, prAuthor: null, prBody }`, `sourceFindingId: null`, `notes: null`;
   - return `toCaseDto(stored.case, null)`.
4. `routes.ts`: `app.post('/agents/:id/eval-cases', { schema: { params: IdParams, body: EvalCaseCreateInput, response: { 201: EvalCase } } }, …)` — one service call, `reply.status(201)`.
5. `test/helpers/eval.ts`: append `manualCaseBody(overrides)` (a valid one-file body) and two diff fixtures: two files in `diff --git` form, two files in plain `---`/`+++` form.
Skills: `onion-architecture` → `rules/fastify-transport.md § A route does exactly four things`, `§ Validation is declarative`; `rules/errors.md § Three rules`; `rules/tracing.md § 3`; `rules/testing.md § The suffix routes the CI lane`. `fastify-best-practices` → `rules/routes.md § Request Body`, `rules/testing.md § Testing Validation Errors`. `zod` → `references/parse-validate-early.md`, `references/type-input-vs-output.md`. `security` → `checklists.md § New API Endpoint Checklist` (workspace scoping, input validation); `SKILL.md § Agentic AI Security` (stored text reaches a prompt only through the engine's blocks).
Tests to add: `server/test/eval-case-create.it.test.ts`:
   - AC-1: 201, the three values; a second call with the same body stores a second row.
   - AC-2: each of the two two-file fixtures reads back byte-identical with two paths in order.
   - AC-3, AC-4: the four meta values; three empty strings.
   - AC-5: one request per listed failure, each 422 with the row count unchanged.
   - AC-6: prose, and a hunk with no `+++` line → 400 `eval_diff_invalid`.
   - AC-7: another path, and lines 40–41 against a hunk of 10–16 → 400 `expectation_outside_diff`.
   - AC-8: an agent of a second workspace → 404.
   - AC-9: a diff of 1,100,000 bytes → a status of 400 or above (state the one seen) and the row count unchanged.
   - AC-22: the list holds a finding-born and a hand-made case, one with `source_finding_id` null.
   - NFR-1: `MockLLMProvider.calls` empty. NFR-2: non-uuid id → 422; a diff naming the file `'; drop table eval_cases; --` with that `file` is stored and read back.
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval-case-create.it eval-cases.it eval-helpers eval-case-editor` is green; the report says whether Docker ran the `.it` files.

### Stage 5 — Edit a case; the run history after an edit
Track: server · After: 4
Files: `server/src/modules/eval/{types,helpers,repository,service,routes}.ts`, `server/test/helpers/eval.ts`, `server/test/eval-case-update.it.test.ts` (New)
Read first: `server/src/modules/eval/service.ts` — `createCase` (stage 4), `listCases`, `startRun` (the `eval_run_in_progress` error it throws); `server/src/modules/eval/repository.ts:226-250,275-300` — `getCase`, `findRunningRun`; `server/src/modules/eval/types.ts:120-150` — `EvalStore`; `server/test/eval-runs.it.test.ts` and `eval-compare.it.test.ts` (SPEC-03 stages 7–8; verify at implementation time) — the scripted provider, `waitForEvalRun`, how a `running` row is inserted; `server/src/modules/skills/repository.ts:128-160` — an update returning the row.
Steps:
1. `helpers.ts`: `caseContentChanged(stored: StoredCase, next: { inputDiff, prTitle, prBody, file, startLine, endLine }): boolean` — strict comparison of the six values (`:63-66`).
2. `types.ts` / `repository.ts`: `EvalStore.updateCase(workspaceId, caseId, patch: { name, inputDiff, inputFiles, inputMeta, expectedOutput, bumpRevision: boolean }): Promise<StoredCase | undefined>` — one `UPDATE … RETURNING`; with `bumpRevision` it sets `revision = revision + 1` in SQL. It never writes `expectation_type`, `owner_id`, `source_finding_id`, `created_at`.
3. `service.updateCase(workspaceId, caseId, input: EvalCaseUpdateInput)`, in this order:
   - `getCase` empty → `NotFoundError('Eval case not found')` (AC-13);
   - `findRunningRun(workspaceId, case.ownerId)` → `AppError(EVAL_ERROR.runInProgress, …, 400, { run_id })`, the form `startRun` uses (AC-14);
   - the diff and expectation checks of stage 4 (AC-12);
   - `updateCase` with `inputMeta` built from the stored `prNumber` / `prAuthor` and the request's title and body (AC-11), `bumpRevision: caseContentChanged(...)` (AC-15); an empty result → 404;
   - return `toCaseDto(updated, lastResultFor(updated.id, updated.revision, doneRuns))` — the same read `listCases` makes.
4. `routes.ts`: `app.put('/eval-cases/:id', { schema: { params: IdParams, body: EvalCaseUpdateInput, response: { 200: EvalCase } } }, …)`.
Skills: `onion-architecture` → `rules/fastify-transport.md`, `rules/errors.md`, `rules/drizzle-persistence.md`, `rules/layers.md § Deciding where a file goes` (the content rule is a pure helper, the order of refusals is the service's). `fastify-best-practices` → `rules/routes.md`, `rules/testing.md`. `drizzle-orm-patterns` → `references/queries-joins-aggregations.md`. `zod` → `references/object-strict-vs-strip.md`. `security` → `checklists.md § New API Endpoint Checklist`.
Tests to add: `server/test/eval-case-update.it.test.ts`:
   - AC-10: every replaced value reads back from the list.
   - AC-11: a finding-born `must_find` case updated with `expectation_type: 'must_not_flag'` in the body reads back `must_find`, its source finding id, number and author.
   - AC-12: a range outside the diff → 400 `expectation_outside_diff`, the case identical.
   - AC-13: a case of a second workspace, and a deleted case → 404.
   - AC-14: with a stored `running` run of the agent → 400 `eval_run_in_progress`, unchanged.
   - AC-15: a rename leaves `revision` 1; a changed `end_line` gives 2.
   - AC-16: `GET /eval-runs/:id` after a rename and a changed expectation equals the read before.
   - AC-17: a run after one content edit holds `case_revision` 2 for that case.
   - AC-18: `last_result` null after a content edit, kept after a rename, the new outcome after the next run.
   - AC-19: two runs around a content edit of one of three cases — metrics over two, `cases_edited` names the case.
   - AC-21: a case row and a run row inserted in the SPEC-03 shape read back with 1.
   - AC-23: with the mock provider, a `done` run with a finding-born and a hand-made case, two outcomes.
   - NFR-1: the provider's `calls` stay empty across the PUTs.
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval-` is green and its `Test Files` count is three more than before B1 (state both counts); `grep -rnE "throw new Error\(" server/src/modules/eval` prints nothing.

### Stage 6 — Client foundation: copy and the two mutations
Track: client · After: 1
Files: `client/messages/en/eval.json`, `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/evals.test.tsx`
Read first: `client/messages/en/eval.json:40-99,149-169` — `caseEditor`, `evalsTab`, `runs.compare`; `client/src/lib/hooks/evals.ts`; `client/src/lib/hooks/evals.test.tsx:1-70` — harness; `client/src/lib/api.ts:65-75` — `api.post`, `api.put`.
Steps:
1. `eval.json` — keep every existing key, the unused reserved ones included (`runCase`, `validJson`, `resultSummary`, …). Add under `caseEditor` (quoted text is fixed by a criterion or the design; the rest is the implementer's wording):
   - `subtitle` "{agent} · simulate a PR and assert the expected output" (`screen_cizruns.jsx:62`)
   - `diffLabel`, `notADiff` (says the text needs `---` / `+++` file lines and an `@@` hunk), `cancel`
   - `expectation.{typeLabel,fileLabel,fileNone,startLineLabel,endLineLabel,titleLabel,severityLabel,categoryLabel,none,expectedLine}`
   - `expectation.mustFind` "must find", `expectation.mustNotFlag` "must NOT flag"
   - `discard.{title,body,confirm,keep}`
   Add under `runs.compare`: `edited` — an ICU plural over `{count}` that says the cases were edited between the two runs and are left out of the values, with `{names}`.
   Reused, not added: `caseEditor.{newCase,caseTitle,save,saving,nameLabel,namePlaceholder,inputLabel,tabs.diff,tabs.prMeta,diffPlaceholder,titleLabel,titlePlaceholder,bodyLabel,bodyPlaceholder,preview,expectedOutput,lastRunPassed,lastRunFailed}`, `evalsTab.{edit,expectedGot,errored}`.
2. `evals.ts`:
   - `useCreateManualEvalCase(agentId)` — `api.post<EvalCase>(\`/agents/${agentId}/eval-cases\`, body)`;
   - `useUpdateEvalCase(agentId)` — `api.put<EvalCase>(\`/eval-cases/${id}\`, body)` with variables `{ id, body }`;
   - both `meta: { inlineError: true }`; on success invalidate `evalKeys.cases(agentId)`.
   Body types: `import type { EvalCaseCreateInput, EvalCaseUpdateInput }`.
Skills: `frontend-ui-architecture` → `devdigest.md § Data access`, `§ Also applies here` (the namespace is the feature area). `react-best-practices` → `SKILL.md § Data Fetching`. `react-testing-library` → `SKILL.md § Hook Testing`.
Tests to add: `evals.test.tsx` — each mutation sends one request with the expected method, URL and body and invalidates the cases key.
Done when: `.claude/agents/scripts/check-code.sh client -- evals.test` is green; `node -e "JSON.parse(require('fs').readFileSync('client/messages/en/eval.json','utf8'))"` — or the test run that imports the file — shows it parses.

### Stage 7 — Diff viewer: an optional line-range marker
Track: client · After: 6
Files: `client/src/components/diff-viewer/{DiffViewer/DiffViewer.tsx,FileCard/FileCard.tsx,CodeLine/CodeLine.tsx,styles.ts,index.ts}`, `client/src/components/diff-viewer/DiffViewer/DiffViewer.test.tsx` (New)
Read first: `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`, `FileCard/FileCard.tsx`, `CodeLine/CodeLine.tsx`, `helpers.ts`, `target.ts`, `findings.ts:1-16` — how labels are passed in by the caller; `client/messages/en/shell.json:33-40` — the `diffViewer` keys the test must register.
Steps:
1. New exported type `DiffRange = { path: string; startLine: number; endLine: number; label: string }` (in `target.ts`, exported from `index.ts`).
2. `DiffViewer` gains `range?: DiffRange` and passes it to the `FileCard` whose path equals `range.path`.
3. `FileCard`: opens when it has a range, as it does for a target (`toggled ?? (isTarget || !!range || autoOpen)`); passes `inRange` to each `CodeLine` whose `newNo` lies inside the range and whose kind is `add` or `ctx`.
4. `CodeLine`: with `inRange`, the row carries `data-in-range="true"`, an inset bar, and in the gutter a glyph with `role="img"` and `aria-label={label}` — the marker that is not colour.
5. Without the prop the output is unchanged; the PR page passes none.
Skills: `frontend-ui-architecture` → `composition.md § Prop design`, `placement.md § Sub-component ownership`. `react-best-practices` → `SKILL.md § Derive, Don't Store`, `§ Accessibility`. `react-testing-library` → `SKILL.md § Query Priority`, `§ Asserting absence`.
Tests to add: `DiffViewer.test.tsx` — with a range 12–13, lines 12 and 13 hold the labelled marker and line 11 does not; without the prop no marker exists; a diff line `<img src=x onerror=alert(1)>` is visible text and no `img` element exists (NFR-3); no "Add a comment" control without `commenting` (AC-32).
Done when: `.claude/agents/scripts/check-code.sh client -- DiffViewer.test DiffTab.test` is green (state the `Test Files` count seen).

### Stage 8 — Case editor: the pure form core
Track: client · After: 7
Files: `…/EvalsTab/helpers.ts` (New), `…/EvalsTab/helpers.test.ts` (New), `…/EvalsTab/_components/CaseList/{helpers.ts,CaseList.tsx}` (the import of `expectedCount` only), `…/EvalsTab/_components/CaseEditorDialog/{helpers.ts,helpers.test.ts,constants.ts}` (New)
Read first: `…/CaseList/helpers.ts`; `client/src/components/diff-viewer/helpers.ts` and `constants.ts` — `parsePatch`, `HUNK_HEADER_RE`; `client/src/lib/types.ts:26` — `PrFile`; `client/src/app/skills/constants.ts:30-42` — the `Exclude` guard; `server/src/adapters/git/diff-parser.ts` and stage 4 step 2 — the rules to mirror.
Steps:
1. Move `expectedCount` unchanged from `CaseList/helpers.ts` to `EvalsTab/helpers.ts`; `CaseList.tsx` imports it from `../../helpers`.
2. `CaseEditorDialog/constants.ts`: `SEVERITIES` and `CATEGORIES` as `as const` tuples, each with the `Exclude` compile guard against the contract type.
3. `CaseEditorDialog/helpers.ts`, pure:
   - `splitDiffFiles(text): Array<PrFile & { hasHunk: boolean }>`, mirroring the server: a file starts at a `diff --git ` line, or, in a text without one, at a `--- ` line directly followed by a `+++ ` line; the path is the text after `+++ ` with a leading `b/` removed, trimmed; a `/dev/null` target or a missing `+++ ` line gives no file; `patch` runs from the file's first hunk header to its end.
   - `FormValues` and `initialValues(evalCase | null)` — a new case: empty strings, type `must_find`.
   - `lineRange(start: string, end: string): { startLine, endLine } | null` — integers, start ≥ 1, end ≥ start.
   - `canSave(values, files)` (AC-34) and `isDirty(values, initial)` (AC-40).
   - `fileAfterDiffChange(file, paths)`: the file when still present, else the single path, else `""` (AC-42, AC-44).
   - `toCreateBody(values)` / `toUpdateBody(values, initial)`: `pr_body` is the opened value when the field text equals `initial.prBody ?? ""`, else the text, and `null` for an empty text on a new case — so an untouched Body never counts as a content change (AC-15).
Skills: `frontend-ui-architecture` → `logic.md § The placement ladder` (rules that need no React are plain functions), `placement.md § Sub-component ownership`, `devdigest.md § Constants and helpers` ("move the file, do not parameterize it in place"). `react-testing-library` → `SKILL.md § What to Test / What to Skip`. `typescript-expert` (by content: `as const`, `Exclude`) → `SKILL.md § Code Review Checklist`.
Tests to add: `CaseEditorDialog/helpers.test.ts` — the two two-file fixtures of stage 4 give the same two paths in order; prose and a headerless `@@` fragment give no file; `lineRange` for 0, 3–2, 12–13; `fileAfterDiffChange` for one file, two files, a renamed path; `toUpdateBody` keeps a null body for an untouched field. `EvalsTab/helpers.test.ts` — `expectedCount`.
Done when: `.claude/agents/scripts/check-code.sh client -- CaseEditorDialog/helpers.test EvalsTab/helpers.test CaseList.test` is green; `grep -rn "expectedCount" client/src` shows one definition.

### Stage 9 — Case editor dialog
Track: client · After: 8
Files: `…/EvalsTab/_components/CaseEditorDialog/{CaseEditorDialog.tsx,CaseEditorDialog.test.tsx,styles.ts,index.ts}` (New)
Read first: `client/src/app/skills/_components/CreateSkillModal/CreateSkillModal.tsx` and `CreateSkillModal.test.tsx:1-50` — a modal form over a mutation; `client/src/components/confirm-dialog/ConfirmDialog.tsx` — opener focus return, Escape, Tab trap; `client/src/vendor/ui/kit/{Modal,Tabs,FormField,TextInput,SelectInput,Textarea}.tsx` — `FormField`'s label is not bound to its control, and `Textarea` / `SelectInput` take no `id`; `…/CaseList/CaseList.tsx:117-140` — `CaseResult`, the wording AC-39 repeats; `docs/design/Dev Digest 2/Dev Digest/screen_cizruns.jsx:55-104`; stage 8's `helpers.ts`; `client/src/components/diff-viewer/index.ts` (stage 7).
Steps:
1. `CaseEditorDialog({ agent: { id, name }, evalCase: EvalCase | null, onClose })`, `"use client"`. `evalCase` null is create mode. Form values are local state seeded once from `initialValues`; the parsed files, `canSave`, `isDirty` and the preview entries are computed during render.
2. A `Modal`: title `caseEditor.newCase` or `caseEditor.caseTitle` with the name; subtitle `caseEditor.subtitle` with the agent's name (AC-28, AC-29). Footer: Cancel and Save.
3. Every field is a `<label>` wrapping its visible text and its control (the implicit binding NFR-8 needs; the vendored controls are used inside it).
   - Name: required, `autoFocus` (focus moves into the dialog).
   - Input: `Tabs` with `tabs.diff` and `tabs.prMeta`. Diff tab: the textarea, then `caseEditor.preview` with `<DiffViewer files={…with a hunk} range={…} />`, or `caseEditor.notADiff` when no file has a hunk and the text is not empty (AC-32, AC-33). PR meta tab: Title and Body.
   - Expectation, under `caseEditor.expectedOutput`: type as two native radios in a `fieldset` in create mode, as plain text in edit mode (AC-30, AC-31); file as a `<select>` over the paths of the current text with `fileNone` first (AC-42); start and end line as number inputs; title; severity and category selects with `none` first. A stored severity or category outside the tuples is offered as one extra option so the form holds the case's value (AC-29).
   - The diff change handler sets the text and `fileAfterDiffChange` in one event (AC-44) — no Effect.
   - `range` for the preview: the chosen file and `lineRange(...)`, label `expectation.expectedLine` (AC-43).
4. Edit mode with `last_result`: `lastRunPassed` / `lastRunFailed` with `evalsTab.expectedGot` (`expectedCount` from `../../helpers`), or `evalsTab.errored` (AC-39).
5. Save: disabled unless `canSave`, and while pending with `caseEditor.saving` (AC-34, AC-36). It calls `useCreateManualEvalCase` or `useUpdateEvalCase` once and closes on success (AC-35, AC-37). On failure the dialog stays, the fields keep their values, and the mutation's `error.message` is shown in a `role="alert"` region (AC-38, NFR-8).
6. Cancel, the close control and Escape call one `requestClose`: closes at once when not dirty, otherwise opens `ConfirmDialog` with the `discard.*` texts (AC-40). The dialog's own Escape listener does nothing while the confirm is open. Focus returns to the opener on unmount, as `ConfirmDialog` does it.
7. All user text is rendered as React text nodes (NFR-3). The component sends no request on open or while typing (NFR-1).
Skills: `frontend-ui-architecture` → `placement.md § Components` ("Rendered by one parent component, never alone → inside that component's folder"), `§ Nesting` (no sub-folder under the dialog), `composition.md § When to split`, `logic.md § The four kinds of state` (form state is the one deliberate copy), `§ Validation` (the client check is UX, the server's is the rule). `react-best-practices` → `SKILL.md § Derive, Don't Store`, `§ Hooks` (the only Effects are the key listener and the focus return), `§ Accessibility`. `react-testing-library` → `SKILL.md § Query Priority`, `§ Scoping queries with within`; `fireEvent` and the two-dialog note of `client/INSIGHTS.md`. `security` → `SKILL.md § Cross-Site Scripting (XSS)`.
Tests to add: `CaseEditorDialog.test.tsx`, real `eval.json`, `common.json` and `shell.json`, mocked `fetch`:
   - AC-28: title, the agent's name, empty name and diff, "must find" checked. AC-29: every field equals the mocked case.
   - AC-30: each control found by its label; no JSON text. AC-31: no type control in edit mode, the type in words.
   - AC-32: after the text changes, the new path and an added line with its number. AC-33: prose shows the message and no file card.
   - AC-34: disabled for each incomplete state, enabled for a complete form.
   - AC-35: one request with method, URL and body, in each mode. AC-36: "Saving…" and no second request on a second click.
   - AC-38: a mocked 400 `expectation_outside_diff` shows its message in the alert region; the diff field keeps its text.
   - AC-39: passed, failed, errored; no line for null.
   - AC-40: a changed form asks; an untouched one closes at once; Escape goes the same way.
   - AC-42: two files offered and none selected; one file selected. AC-43: lines 12–13 marked, 11 not; a changed end line moves it. AC-44: with two files, renaming the chosen path clears the choice and disables Save.
   - NFR-1: opening and typing send no request. NFR-3: a name and a diff line holding `<img src=x onerror=alert(1)>` are text. NFR-8: focus inside after open, on the opener after close.
Done when: `.claude/agents/scripts/check-code.sh client -- CaseEditorDialog.test` is green with `Test Files 1`; `grep -nE ">[A-Z][a-z]+ [a-z]" "client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CaseEditorDialog/CaseEditorDialog.tsx"` prints nothing (NFR-7).

### Stage 10 — Evals tab wiring and the compare note
Track: client · After: 9
Files: `…/EvalsTab/EvalsTab.tsx`, `EvalsTab.test.tsx`, `…/CaseList/CaseList.tsx`, `CaseList.test.tsx`, `client/src/components/eval-runs/RunHistory/_components/CompareRunsDialog/{CompareRunsDialog.tsx,CompareRunsDialog.test.tsx}`
Read first: `…/EvalsTab/EvalsTab.tsx` — the `CaseList` call at the end of the cases branch; `…/CaseList/CaseList.tsx:38-52,82-110` — the empty actions slot and the delete button's accessible name; `EvalsTab.test.tsx:1-115` — fixtures and the render helper; `CompareRunsDialog.tsx:140-170` — the left-out notice; `client/specs/2026-10-12-eval-trend-charts-plan.md:289` — SPEC-05 adds one sibling between the scoring note and the cases block; this stage does not touch those lines.
Steps:
1. `CaseList` gains `actions?: React.ReactNode`, rendered in the inner empty `s.actions` slot, and `onEdit?: (c: EvalCase) => void`. Each row gets a native button before Delete, `aria-label={\`${t("evalsTab.edit")} ${item.name}\`}` — the form Delete uses (AC-27).
2. `EvalsTab`: state `editor: { evalCase: EvalCase | null } | null`, initially null (AC-41). It passes `actions={<Button … onClick={() => setEditor({ evalCase: null })}>{t("caseEditor.newCase")}</Button>}` and `onEdit` to `CaseList` — the control stands beside the run control and shows for an empty list (AC-26). It renders `<CaseEditorDialog key={editor.evalCase?.id ?? "new"} agent={agent} evalCase={editor.evalCase} onClose={() => setEditor(null)} />` as the last child while `editor` is set.
3. `CompareRunsDialog`: when `data.cases_edited.length > 0`, one more line in the notice area with `runs.compare.edited` (count and names) — shown also when both `cases_only_in_*` are empty (AC-20).
Skills: `frontend-ui-architecture` → `placement.md § Sub-component ownership` (the tab imports its direct children only), `composition.md § Composition patterns` (a slot prop, not a flag). `react-best-practices` → `SKILL.md § State Management` (the dialog's open state stays in the tab, not in the URL), `§ Key Prop Patterns`, `§ Accessibility`. `react-testing-library` → `SKILL.md § Query Priority`.
Tests to add:
   - `CaseList.test.tsx` — two rows, each with a button named "Edit <case name>" (AC-27).
   - `EvalsTab.test.tsx` — the control for a list of cases and for an empty list (AC-26); a fresh render shows no dialog (AC-41); a mocked 201 then a list read holding the new case — the row appears and the dialog is gone (AC-37); edit opens the dialog with the row's case.
   - `CompareRunsDialog.test.tsx` — a response with one edited case shows the note and the name (AC-20).
Done when: `.claude/agents/scripts/check-code.sh client -- EvalsTab.test CaseList.test CompareRunsDialog.test AgentEditor.test` is green with `Test Files 4`.

### Stage 11 — Static checks an implementer cannot run (CALLING SESSION)
Track: calling session · After: 5, 10
Files: none in the repository
Read first: `specs/2026-10-12-eval-pipeline-plan.md:786-801` — both recipes.
Steps:
1. Type-check the new server tests with the `/tmp` tsconfig of SPEC-03 stage 15 step 2; its `include` already covers `server/test/eval-*.ts` and `server/test/helpers/eval.ts`. Expected: exit 0. An error goes back to the server track as a fix brief.
2. `next build` on a copy, exactly as SPEC-03 stage 15 step 3. Expected: `/agents/[id]` builds; a `Can't resolve ./contracts/…js` means a value import from `@devdigest/shared`.
3. `cd server && pnpm verify:l06` with Docker running; then the rows of §6.
Skills: none routed.
Tests to add: none.
Done when: the three steps are clean and every §6 row is green.

### Stage 12 — Migration on the dev DB (CALLING SESSION)
Track: calling session · After: 3 (when it runs is question 2)
Files: none in the repository; database `devdigest` in `devdigest-postgres`
Read first: `INSIGHTS.md:37-41`; `specs/2026-10-12-eval-pipeline-plan.md:803-818` — the same cycle for `0017`.
Steps, in order:
1. What this could undo: nothing — one added column, no row read or written. Record `select (select count(*) from eval_cases), (select count(*) from eval_runs), (select count(*) from eval_runs where status = 'running'), (select count(*) from drizzle.__drizzle_migrations)` → `C|R|0|18`. A running run → wait. A migration count of 19 means a dev-stack start already applied `0018` without a dry run: stop and report.
2. Backup: `docker exec devdigest-postgres pg_dump -U devdigest -Fc devdigest > /tmp/devdigest-pre-case-editor-<stamp>.dump`. Keep it until the user has looked.
3. Copy: `createdb -U devdigest devdigest_casecheck` and `pg_restore --no-owner` from the dump, in the same container.
4. Before-export of the copy, sorted `psql -At`, one file per table: `select *` for every table; for `eval_cases` the explicit list `id, workspace_id, owner_kind, owner_id, name, input_diff, input_files, input_meta, expected_output, notes, expectation_type, source_finding_id, created_at`.
5. Dry run: `cd server && DATABASE_URL=postgres://devdigest:devdigest@localhost:5432/devdigest_casecheck pnpm db:migrate`.
6. After-export with the same queries. `comm -3 before/<t>.txt after/<t>.txt` is empty for every table, `eval_cases` and `eval_runs` included — the real cases and runs of the SPEC-03 experiment are unchanged. `select count(*), min(revision), max(revision) from eval_cases` → `C|1|1`. `\d eval_cases` shows `revision integer not null default 1`.
7. `dropdb -U devdigest devdigest_casecheck`.
8. Real DB: the same export, `cd server && pnpm db:migrate`, the same diff and the same three reads; the count of step 1 → `C|R|0|19`.
Skills: `postgresql-table-design` → `SKILL.md § Safe Schema Evolution`.
Tests to add: none (NFR-5 is a manual verify).
Done when: both diffs are empty and the migration count is 19. Evidence: the dump path, the two diff summaries, the `\d` line.

## 5. Skills matrix

| Stage | onion-architecture | fastify-best-practices | drizzle-orm-patterns | postgresql-table-design | zod | security | frontend-ui-architecture | react-best-practices | react-testing-library | typescript-expert |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `rules/zod-contracts.md`, `rules/testing.md` | — | `references/schema-definition.md` | `SKILL.md § Safe Schema Evolution` | `references/object-strict-vs-strip.md`, `refine-add-path.md`, `object-extend-for-composition.md`, `refine-defaults.md`, `object-optional-vs-nullable.md` | — | — | — | `SKILL.md § What to Test / What to Skip` | — |
| 2 | `rules/domain-purity.md`, `rules/tracing.md § 3`, `rules/drizzle-persistence.md`, `rules/zod-contracts.md`, `rules/testing.md` | — | `references/schema-definition.md` | — | — | — | — | — | — | — |
| 3 | — | — | `references/migrations.md` | `SKILL.md § Safe Schema Evolution` | — | — | — | — | — | — |
| 4 | `rules/fastify-transport.md`, `rules/errors.md`, `rules/tracing.md § 3`, `rules/testing.md` | `rules/routes.md`, `rules/testing.md` | — | — | `references/parse-validate-early.md`, `type-input-vs-output.md` | `checklists.md § New API Endpoint Checklist`, `SKILL.md § Agentic AI Security` | — | — | — | — |
| 5 | `rules/fastify-transport.md`, `rules/errors.md`, `rules/drizzle-persistence.md`, `rules/layers.md` | `rules/routes.md`, `rules/testing.md` | `references/queries-joins-aggregations.md` | — | `references/object-strict-vs-strip.md` | `checklists.md § New API Endpoint Checklist` | — | — | — | — |
| 6 | — | — | — | — | — | — | `devdigest.md § Data access` | `SKILL.md § Data Fetching` | `SKILL.md § Hook Testing` | — |
| 7 | — | — | — | — | — | — | `composition.md § Prop design`, `placement.md § Sub-component ownership` | `SKILL.md § Derive, Don't Store`, `§ Accessibility` | `SKILL.md § Query Priority`, `§ Asserting absence` | — |
| 8 | — | — | — | — | — | — | `logic.md § The placement ladder`, `placement.md § Sub-component ownership`, `devdigest.md § Constants and helpers` | — | `SKILL.md § What to Test / What to Skip` | `SKILL.md § Code Review Checklist` |
| 9 | — | — | — | — | — | `SKILL.md § Cross-Site Scripting (XSS)` | `placement.md § Components`, `§ Nesting`; `composition.md § When to split`; `logic.md § The four kinds of state`, `§ Validation` | `SKILL.md § Derive, Don't Store`, `§ Hooks`, `§ Accessibility` | `SKILL.md § Query Priority`, `§ Scoping queries with within` | — |
| 10 | — | — | — | — | — | — | `placement.md § Sub-component ownership`, `composition.md § Composition patterns` | `SKILL.md § State Management`, `§ Key Prop Patterns`, `§ Accessibility` | `SKILL.md § Query Priority` | — |
| 11, 12 | — | — | — | 12: `SKILL.md § Safe Schema Evolution` | — | — | — | — | — | — |

## 6. Verification

| Package | Command (from the repository root) | Proves |
|---|---|---|
| server | `.claude/agents/scripts/check-code.sh server` | typecheck, `depcruise`, the unit lane — AC-18, 19, 21 (pure halves), AC-24, AC-25, NFR-4; the existing suites unchanged |
| server | `.claude/agents/scripts/check-code.sh --it server` (Docker) | the same, then the `.it` lane — AC-1…AC-19, AC-21…AC-23, NFR-1, NFR-2; the SPEC-03 suites (NFR-6) |
| server | `cd server && pnpm verify:l06` | the new `test/eval-case-*` files are inside the lesson's script |
| server | `/tmp` tsconfig type-check (stage 11 step 1) | the new test files type-check |
| server | `cd server && ./node_modules/.bin/drizzle-kit generate` → "No schema changes" | the `0018` snapshot equals the schema |
| server | `grep -rnE "throw new Error\(" server/src/modules/eval` → nothing | `rules/errors.md` |
| both | `diff -u server/src/vendor/shared/contracts/eval.ts client/src/vendor/shared/contracts/eval.ts` → nothing | NFR-4 |
| both | `grep -rn "EvalCaseInput" server/src client/src` → nothing | the reserved payload is gone from both copies |
| client | `.claude/agents/scripts/check-code.sh client` | typecheck with tests, component tests — AC-20, AC-26…AC-44, NFR-1, NFR-3, NFR-7, NFR-8 |
| client | `next build` on a copy (stage 11 step 2) | no value import from `@devdigest/shared` |
| client | the `grep` of stage 9's Done-when | NFR-7 |
| mcp | `.claude/agents/scripts/check-code.sh mcp` | NFR-6: the MCP suite passes unchanged |
| repo | `git status --short reviewer-core mcp e2e evals .claude` → nothing from this work | NFR-6, NG-4 |
| dev DB | stage 12 | NFR-5 |

No e2e row (NG-4). No live row: no criterion asks for one, and a live check writes cases into the user's real set.

## 7. Risks and open questions

- [blocking] Execution mode — options: multi-agent / single-agent (question 1).
- [blocking for stage 12] When `0018` is applied to the dev DB — options: right after stage 3 / after stage 11 (question 2).
- [non-blocking] The dev stack during implementation. Once stage 1 lands `revision` in `schema/eval.ts`, a running `tsx watch` API selects a column the dev DB does not have, and every eval route answers 500 until stage 12. No data is at risk. A `./scripts/dev.sh` start after stage 3 would apply `0018` with no dry run. Question 2 decides the order.
- [non-blocking] Reading of AC-2 for a multi-file text without `diff --git` lines. `parseUnifiedDiff` folds such a text into one file under the last path (`server/src/adapters/git/diff-parser.ts:40-45`). AC-2 asks for "every file the diff names", so stage 4 adds the eval-local `parseCaseDiff` and leaves the adapter (and live reviews) untouched. A deleted line starting `-- ` directly followed by an added line starting `++ ` inside a hunk would be read as a file boundary; the adapter already misreads such lines.
- [non-blocking] The client splits the pasted text with its own helper (stage 8) and the server with `parseCaseDiff`. The two share fixtures by copy, not by import. Where they disagree, the preview shows and the save is refused with the API's message (AC-38).
- [non-blocking] Reading of AC-42 with AC-44: on a one-file text the choice is cleared and the single file is selected again, so the AC-44 check uses a two-file text.
- [non-blocking] AC-42's file list offers every file the text names, a file without a hunk included; choosing one is refused by AC-7.
- [non-blocking] NFR-6 says the SPEC-03 suites "pass unchanged", and the new record fields are required on the wire (`:228-232` mark none optional). So `server/test/eval-contracts.test.ts` and the typed client fixtures gain the fields, with no assertion changed. A SPEC-03 suite that fails only on an exact-equality check of a body is reported by stage 3, not edited. If the user reads NFR-6 as "no SPEC-03 test file is edited at all", that goes to `spec-creator`.
- [non-blocking] Choices the source leaves open, made here:
  - the order of refusals: 404, then `eval_run_in_progress`, then `eval_diff_invalid`, then `expectation_outside_diff`;
  - `cases_edited` holds the newer run's `case_name`, and an edited case is not also listed in `cases_only_in_*`;
  - a case whose number or author is null gets the title-only task line; with an empty title the line reads `Review pull request "".`;
  - `PUT` returns `last_result` computed as the list computes it; `POST` returns null;
  - `revision` is incremented in SQL, so two tabs saving content changes give two increments (EC-12 asks for no conflict detection);
  - an untouched Body field sends the opened value (stage 8), so null and "" never flip by themselves.
- [non-blocking] AC-9 names no status. Fastify answers a body over the limit itself; the test asserts 400 or above and the row count, and states the status seen.
- [non-blocking] The vendored `Modal` renders its close control with the literal label "Close" (`client/src/vendor/ui/kit/Modal.tsx:57`), as it does for every dialog. NFR-7's check is scoped to the editor's own files.
- [non-blocking] The preview re-parses the text on every change. A paste near the 1 MB limit may type slowly; no criterion sets a bound, and the file cards above 200 changed lines start collapsed.
- [non-blocking] Not checked by me: the dev DB (no psql here); whether Docker is available to implementers; `runner.ts` and the compare half of `service.ts`, which were not in the tree; that drizzle-kit 0.30 accepts `--name` on this install (stage 3 step 3 is the fallback).
- [→ researcher] none. [→ brainstorm] none. [→ spec-creator] none.

## 8. Handoff to reviewers

- Architecture:
  - `titleOnlyTaskLine` beside `taskLine` in `server/src/domain/reviews/prompt-parts.ts`, both built on one constant;
  - `parseCaseDiff` in `eval/helpers.ts` wrapping the adapter parser, and its use inside `buildCaseReviewInput` — a second reading of a diff next to `parseUnifiedDiff`;
  - `EvalStore.updateCase`, the first update of `eval_cases`, with the revision increment in SQL;
  - the optional `range` prop through `DiffViewer` → `FileCard` → `CodeLine`, a cross-route component used by the PR page;
  - `expectedCount` moved up to `EvalsTab/helpers.ts`;
  - the Escape and focus-return code now exists in `ConfirmDialog`, `CompareRunsDialog` and `CaseEditorDialog` — a shared hook is a candidate, not part of this plan;
  - removal of the reserved `EvalCaseInput` from both `eval-ci.ts` copies.
- Security:
  - two new routes with params and body schemas; workspace scoping on both (AC-8, AC-13);
  - a user-pasted diff and PR text stored and replayed to a model on every run, only through `assemblePrompt`'s untrusted blocks (UI-1, UI-2); the title stands in the task line as a live review's does; the delimiter gap of NG-5 applies unchanged;
  - no diff limit below the 1 MB body limit, and the list returns every case's whole diff (EC-16);
  - pasted text rendered in the preview, the editor and the tab as text nodes (NFR-3);
  - the 422 body carries `details` from the validator (`server/src/app.ts:126-131`), as for every route.

## 9. Execution

Mode: multi-agent — questions 1–2 answered 2026-10-12 with the recommended options (the user's "take all recommended"): multi-agent; `0018` is applied to the dev DB right after stage 3, with the dry-run recipe. REC1, REC2 not accepted.
Recommended: multi-agent. After stage 3 the server track (stages 4–5) and the client track (stages 6–10) share no file, and each is several stages of real work. Inside a track the stages chain.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| shared | 1–2 | both `src/vendor/shared/contracts/{eval,eval-ci}.ts`; `server/src/db/schema/eval.ts`; `server/test/eval-contracts.test.ts`; `server/test/eval-case-editor.test.ts`; `server/src/domain/reviews/prompt-parts.ts`; `server/src/modules/eval/{types,helpers,repository,service,runner}.ts`; the client test files of §2 row 5 | SPEC-03 stages 1–15 | alone; not beside SPEC-05 B3 (`EvalsTab.test.tsx`, `AgentEvalView.test.tsx`) |
| calling session | 3 | `server/src/db/migrations/**` | 2 | alone; client stage 6 may start meanwhile |
| server | 4, 5 | `server/src/modules/eval/**`; `server/test/eval-case-{create,update}.it.test.ts`; `server/test/helpers/eval.ts` | 3 | parallel with the client track |
| client | 6, 7 | `client/messages/en/eval.json`; `client/src/lib/hooks/evals{.ts,.test.tsx}`; `client/src/components/diff-viewer/**` | 1 | parallel with the server; not beside SPEC-05 B1 (`eval.json`) |
| client | 8, 9 | `…/EvalsTab/helpers{.ts,.test.ts}`; `…/CaseList/{helpers.ts,CaseList.tsx}`; `…/CaseEditorDialog/**` | 7 | parallel with the server |
| client | 10 | `…/EvalsTab/{EvalsTab.tsx,EvalsTab.test.tsx}`; `…/CaseList/{CaseList.tsx,CaseList.test.tsx}`; `…/CompareRunsDialog/{CompareRunsDialog.tsx,CompareRunsDialog.test.tsx}` | 9 | parallel with the server; not beside SPEC-05 B3 (`EvalsTab.tsx`, `EvalsTab.test.tsx`) or its B2 if that hoist touches `RunHistory/` |
| join (calling session) | 11, 12 | none; the dev DB | 5, 10 (12: per question 2) | alone |

Order against SPEC-05: either plan may go first on a shared file, never both at once. The later brief reads the file as it then stands. Stage 10 leaves the lines between the scoring note and the cases block alone; SPEC-05 B3 leaves the `CaseList` props and the tab's last child alone.

Briefs — a fresh `implementer` per brief, in order inside a track. Each brief text is followed by its stages' text, `Read first` lists and `Skills` lines copied from §4.
- B1 · shared · stages 1–2 → "Execute stages 1–2 of specs/2026-10-12-case-editor-plan.md (track shared). Write only inside: server/src/vendor/shared/contracts/{eval,eval-ci}.ts, the same two under client/src/vendor/shared, server/src/db/schema/eval.ts, server/test/eval-contracts.test.ts, server/test/eval-case-editor.test.ts, server/src/domain/reviews/prompt-parts.ts, server/src/modules/eval/{types,helpers,repository,service,runner}.ts, and the client eval test files that the client typecheck names (fixtures only). Generate no migration; do not run the .it lane. Check with: .claude/agents/scripts/check-code.sh client, then .claude/agents/scripts/check-code.sh server -- eval-case-editor eval-helpers eval-contracts reviews-helpers prompt-structured src/modules/eval/scoring."
- S1 · server · stage 4 → "Execute stage 4 (track server). Write only inside: server/src/modules/eval/{constants,helpers,service,routes}.ts, server/test/helpers/eval.ts, server/test/eval-case-create.it.test.ts. Do not edit server/src/adapters. Check with: .claude/agents/scripts/check-code.sh --it server -- eval-case-create.it eval-cases.it eval-helpers eval-case-editor."
- S2 · server · stage 5 → "Execute stage 5 (track server). Write only inside: server/src/modules/eval/{types,helpers,repository,service,routes}.ts, server/test/helpers/eval.ts, server/test/eval-case-update.it.test.ts. Check with: .claude/agents/scripts/check-code.sh --it server -- eval-."
- C1 · client · stages 6–7 → "Execute stages 6–7 (track client). Write only inside: client/messages/en/eval.json (add keys under caseEditor and runs.compare only), client/src/lib/hooks/evals.ts, client/src/lib/hooks/evals.test.tsx, client/src/components/diff-viewer/. Import only types from @devdigest/shared. Check with: .claude/agents/scripts/check-code.sh client -- evals.test DiffViewer.test DiffTab.test."
- C2 · client · stages 8–9 → "Execute stages 8–9 (track client). Write only inside: client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers.ts, helpers.test.ts, _components/CaseList/helpers.ts, _components/CaseList/CaseList.tsx (the expectedCount import only), _components/CaseEditorDialog/. Do not edit message files or client/src/vendor/ui; report a missing key. fireEvent only. Check with: .claude/agents/scripts/check-code.sh client -- CaseEditorDialog EvalsTab/helpers.test CaseList.test."
- C3 · client · stage 10 → "Execute stage 10 (track client). Write only inside: …/EvalsTab/{EvalsTab.tsx,EvalsTab.test.tsx}, …/EvalsTab/_components/CaseList/{CaseList.tsx,CaseList.test.tsx}, client/src/components/eval-runs/RunHistory/_components/CompareRunsDialog/{CompareRunsDialog.tsx,CompareRunsDialog.test.tsx}. Do not edit message files, eval-runs/index.ts or eval-runs/helpers.ts. Check with: .claude/agents/scripts/check-code.sh client -- EvalsTab.test CaseList.test CompareRunsDialog.test AgentEditor.test."
- Calling session: stage 3 after B1; stage 12 per question 2; stage 11 after S2 and C3.

multi-agent: B1 → stage 3 (C1 may start once B1 has reported) → S1, S2 alongside C1, C2, C3 → 11, 12. At most two implementers run at once.
single-agent: B1, stage 3, S1, S2, C1, C2, C3, then 11, 12; the Runs column is not used.

The user's steps: the commit and the PR; a look at the editor in a browser if wanted (it writes real cases into the dev set).

## 10. Recommendations — not applied

- REC1 [requirements] Give the two refusals a user can reach from the form a message of their own.
  - Why: a 422 answers "Request validation failed" for every cause (`server/src/app.ts:126-131`), and AC-38 shows the API's message. Two 422s are reachable through the editor: a name over 64 characters, and a finding-born case whose stored severity or category is outside the enums — SPEC-03 stores them as free text (`server/src/vendor/shared/contracts/eval.ts:17-25`, `server/INSIGHTS.md § Codebase Patterns`), and such a case cannot be saved, even renamed, until the author picks another value. US-6 asks that "a refused save says what is wrong".
  - Would change: AC-5 or AC-11 and AC-34 (a superseding spec); one attribute and one branch in stage 9, possibly the update schema in stage 1.
  - My recommendation: not now. Build as written; the stored-value case needs a decision on whether an unchanged out-of-contract value may pass an update.
- REC2 [requirements] Reword `evalsTab.emptyCases` to name both ways a case comes into being.
  - Why: the text SPEC-03 DR-19 set says only "Accept or dismiss a finding… then use 'Turn into eval case'" (`client/messages/en/eval.json:72`), and after this feature "New eval case" stands next to it (AC-26).
  - Would change: one string in stage 6 and the SPEC-03 test that reads it.
  - My recommendation: accept later with any copy pass; no criterion depends on it.

## Questions for the user
The calling session asks these with AskUserQuestion and sends the answers back; the implementer does not start before every [blocking] one is answered. By the user's delegation ("take all recommended") the recommended option is taken for each.
1. [blocking] Execution mode — multi-agent or single-agent?
   - multi-agent (recommended) — after B1 and the migration, the server briefs (S1, S2) and the client briefs (C1, C2, C3) have disjoint write sets; at most two implementers at once.
   - single-agent — the same six briefs one after another; no merge risk; roughly twice the wall-clock time.
2. [blocking for stage 12] When is `0018` applied to the dev DB?
   - right after stage 3 (recommended) — the migration is final by then (one additive column, the `.it` suites green on it); the older code ignores the column, so the running dev stack keeps working through the rest of the build; the dry-run recipe is the same.
   - after stage 11 — the dev DB is written only once everything is green; until then the dev stack must stay stopped, or its eval routes answer 500, and a `./scripts/dev.sh` start would apply the migration with no dry run.
Recommendations awaiting a decision: REC1, REC2 (section 10) — recommended answer for both: not now; the plan stands as written.
Gaps for `spec-creator`, not questions of mine: none.
