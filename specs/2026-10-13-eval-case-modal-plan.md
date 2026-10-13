# Implementation Plan — Eval case modal (SPEC-09)
Source: `specs/2026-10-13-eval-case-modal.md` (Status: approved, `check-spec.sh` ok, 0 blocking) · Base: `1d4e77f` + the uncommitted SPEC-03…05 tree · Packages: server, client

All paths are relative to `/home/klov/emdash/repositories/dev-digest/`. Abbreviations used below:
- `PR/` = `client/src/app/repos/[repoId]/pulls/[number]/_components`
- `ET/` = `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab`
- `CE/` = `client/src/components/eval-case-editor` (New)
- `EV/` = `server/src/modules/eval`

**Priority.** P1 = stages 1–8 (spec D1–D6), shippable alone. P2 = stages 9–16; each of 11–15 can land without the others.

## 0. Before the first edit
- INSIGHTS `INSIGHTS.md § What Doesn't Work` — "An implementer's token bill is turns × standing context" → briefs of one or two stages, `Read first` batched in one message.
- `INSIGHTS.md § What Doesn't Work` — "`git grep` passes vacuously for an untracked module" → the eval tree is untracked; absence checks use `grep -rn`.
- `INSIGHTS.md § What Works` — "diff `agent_runs` / `run_traces`" and "dry run on a restored copy" → stage 8 proves Cancel by row counts and takes a `pg_dump` first.
- `INSIGHTS.md § Recurring Errors` — "`psql -U postgres` … role does not exist" and "API drops … it is killed" → `psql -U devdigest -d devdigest`; the dev stack must be running detached.
- `server/INSIGHTS.md § Codebase Patterns` — "`findings.severity` is free text" → the draft carries plain strings (`EvalExpectedOutput`); the try body's expectation has no `Severity` enum, so a stored case with an odd severity still runs (EC-33).
- same — "A seeded agent has no `agent_versions` row for version 1" → the stage 15 test creates its agent through `POST /agents`, never the seed.
- same — "`AgentsRepository.deleteById` deletes the agent's `eval_cases`" → the owner of an existing case always exists (AC-20).
- same — "schema-failed call surfaces as a plain `Error` from OpenRouter" → a try catches every error into `status: error` (AC-44).
- same — "A studio review is ONE LLM call" (mock bills `costUsd` 0.001) → AC-39 and NFR-2 expectations.
- same — "An eval run has no per-case deadline" → OQ-2 default: no deadline.
- same — "`wrapUntrusted` closes … exact string only" → NG-8, not touched.
- `server/INSIGHTS.md § Tool & Library Notes` — "`tsx watch` does not restart on `src/vendor/`" → stage 1 is live only after a save under `server/src/modules`.
- same — "`pnpm typecheck` does not look at `test/**`", with the `/tmp` tsconfig and `typeRoots` corrections → new server tests are type-checked by the calling session (stages 8, 16).
- `server/INSIGHTS.md § Recurring Errors` — "`statusCode` does not exist on `void & Promise<Response>`" → type an inject payload as `Record<string, unknown>`.
- `client/INSIGHTS.md § Recurring Errors` — "`No QueryClient set`" → stage 7 owns every suite that renders `FindingCard`.
- same — "Evals tab overflowed" → `minmax(0, 1fr)` and `overflowWrap: "anywhere"` on every new grid holding repo text.
- same — "vendored `@devdigest/shared` is TYPE-only" → `import type` only; `next build` on a copy is the proof.
- same — "blank and unstyled after `pnpm build`" → never build in the live `client/`.
- same — "A vitest hook that RETURNS a function" → block-body `beforeEach`.
- `client/INSIGHTS.md § Tool & Library Notes` — no `user-event` (use `fireEvent`); `Modal` renders inline, so `getByRole("dialog")` finds two with `ConfirmDialog` open; `setDefaultOptions` drops `staleTime` when counting requests; `{x, number}` for ICU numbers; client `tsc` covers tests with `noUncheckedIndexedAccess`; a vitest filter matches folder names and fails silently on `[segment]` paths.
- Read: the spec § Contracts (`:335-390`), `client/docs/findings-surfaces.md` (stage 7), `TESTING.md § Conventions`.

## 1. Scope — as the source states it
Goal: G-1…G-8 — `specs/2026-10-13-eval-case-modal.md:49-56`
Non-goals: NG-1…NG-9 — `:58-66`. NG-9 "A database migration" is confirmed: every new value is read from `eval_cases`, `eval_runs`, `findings`, `pull_requests` and `agents` as they are (`EV/repository.ts`). `git status --short server/src/db/migrations` shows only the untracked `0017` / `0018` of SPEC-03/04; this plan adds none.
Acceptance criteria (pointer table; wording stays in the spec, `:112-232`, NFR `:272-285`):

| Criteria | Stage | State |
|---|---|---|
| AC-1, AC-2, AC-3 | 7 (tests kept) | already there `PR/FindingCard/_components/EvalCaseAction/EvalCaseAction.tsx:16-44` |
| AC-4…AC-11, AC-32, AC-33 | 7 | clear |
| AC-12, AC-14…AC-22, NFR-9 | 2 | clear |
| AC-13 | 2 (reused) | already there `EV/helpers.ts:37`, `server/test/eval-case-name.test.ts` |
| AC-23…AC-30 | 2 | clear |
| AC-31, AC-34, AC-35, AC-49…AC-60 (modal part) | 6 | clear |
| AC-36…AC-48, NFR-2, NFR-3, NFR-4, NFR-13 | 3 | clear |
| NFR-5, NFR-7 (P1 part) | 1, 2, 3 | clear |
| NFR-1, NFR-6, NFR-10, NFR-11 | 6, 7, 11–15 | clear |
| NFR-8 | 2, 8, 16 | clear |
| AC-61…AC-65 | 11 | clear |
| AC-66…AC-71, AC-60 (row part) | 12 | clear |
| AC-72, AC-89, NFR-14, NFR-7 (dashboard part) | 10 | clear |
| AC-73…AC-80 | 13 | clear |
| AC-90, AC-91, NFR-12 | 14 | clear |
| AC-81…AC-84, AC-86, AC-88 | 15 | clear; AC-84 carries `[NEEDS CLARIFICATION … → OQ-1]`, planned with its default (seven values, skill links untouched) |
| AC-85 | 15 (test only) | already there `server/src/modules/agents/repository.ts:124-155` |
| AC-87 with EC-27 | 15 | open → F1 |

## 2. Impact map
| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| both | `{server,client}/src/vendor/shared/contracts/eval.ts` | Modify | contract, two copies | NFR-7 |
| server | `EV/{routes,service,helpers,runner,types}.ts` | Modify | route → service → helpers / runner | AC-12…30, 36…48 |
| server | `EV/repository.ts` | Modify (stage 10) | repository | AC-72, AC-89 |
| server | `server/test/eval-case-draft.it.test.ts`, `eval-case-try.it.test.ts`, `eval-dashboard-rows.it.test.ts`, `eval-promote.it.test.ts` | New | integration | per stage |
| server | `server/test/{eval-cases.it,eval-case-create.it,eval-runs.it,eval-helpers,eval-contracts}.test.ts`, `server/test/helpers/eval.ts` | Modify | tests | NFR-8 |
| client | `CE/**` (moved from `ET/_components/CaseEditorDialog/`), `CE/TryResult/**` | New (move) | cross-route tier | AC-6…11, 31, 34, 35, 49…65 |
| client | `ET/helpers.ts`, `ET/helpers.test.ts` | Delete (moved into `client/src/components/eval-runs/helpers{,.test}.ts`) | cross-route tier | — |
| client | `ET/EvalsTab.tsx`, `ET/_components/CaseList/**` | Modify | route-local | AC-66…71 |
| client | `client/src/lib/api.ts`, `client/src/lib/hooks/{evals,agents}.ts`, `client/src/lib/hooks/evals.test.tsx` | Modify | data layer | AC-4, 31, 51, 76, 80, 84 |
| client | `PR/FindingCard/_components/EvalCaseAction/**`, `PR/FindingsPanel/FindingsPanel.tsx`, `PR/{FindingCard,FindingsPanel,DiffTab}/*.test.tsx` | Modify | route-local | AC-1…11, 32, 33 |
| client | `client/src/app/eval/_components/EvalDashboard/**` | Modify | route-local | AC-73…80, 90, 91 |
| client | `client/src/components/eval-runs/RunHistory/_components/CompareRunsDialog/**` | Modify | cross-route | AC-81…88 |
| client | `client/messages/en/eval.json`, `client/messages/en/prReview.json` | Modify (stage 5; stage 9 for `eval.json` only) | i18n | NFR-10 |

## 3. Constraints in play
- depcruise: `no-routes-to-drizzle`, `drizzle-only-in-repositories`, `no-service-to-container`, `no-cross-module-internals`. `EvalService` keeps taking `EvalDeps` only; no new port is needed in P1, and stage 10 extends `EvalStore`.
- Module conventions: refusals are `AppError(code, message, 400)`; no `throw new Error(` in `EV/`; the repository throws no `AppError` and returns no row type; `EV/scoring.ts` keeps zero imports; the paid route carries `EVAL_RUN_RATE_LIMIT`.
- Both contract copies change in one stage, with `diff -u` in Done-when (stages 1 and 10).
- `server/test/eval-*.ts` naming for every new server test, so `verify:l06` and the tsc include globs pick them up.
- `import type` only from `@devdigest/shared` in `client/`; strings only in the two message files, each with one owner stage per tier (5, then 9).
- Implementers never write lockfiles, `server/package.json`, `server/src/db/migrations/**`, `.env*`, `.claude/settings*.json`, or anything outside the repository.
- Files are moved with plain `mv`, never `git mv` (no git state change).
- `reviewer-core/` is not touched (NG-6); `git status --short reviewer-core` stays empty.

## 4. Stages

### Stage 1 — P1 contracts, both copies (P1)
Track: shared · After: —
Files: `server/src/vendor/shared/contracts/eval.ts`, `client/src/vendor/shared/contracts/eval.ts`, `server/test/eval-contracts.test.ts`
Read first: `server/src/vendor/shared/contracts/eval.ts` — the neighbours (`EvalExpectedOutput`, `EvalInputMeta`, `EvalOutcomeFinding`, `NotBlank`, `EvalCase`); `server/test/eval-contracts.test.ts:44-75` — the byte-identity test and the shape tests to extend.
Steps:
1. Append the same text to both copies, after `EvalCaseCreateInput`:
   - `EvalDraftProblem = z.enum(['file_not_in_diff','lines_outside_diff'])`
   - `EvalCaseDraft = z.object({ expectation_type: EvalExpectationType, name: z.string(), input_diff: z.string(), input_meta: z.object({ pr_number: z.number().int(), pr_title: z.string(), pr_author: z.string(), pr_body: z.string().nullable() }), expected_output: EvalExpectedOutput, problem: EvalDraftProblem.nullable() })`
   - `EvalCaseDraftResponse = z.object({ agent: z.object({ id: z.string(), name: z.string() }), case: EvalCase.nullable(), draft: EvalCaseDraft.nullable() })`
   - `EvalCaseTryInput = z.object({ expectation_type: EvalExpectationType, input_diff: NotBlank, input_meta: EvalInputMeta, expected_output: z.object({ file: NotBlank, start_line: z.number().int().min(1), end_line: z.number().int() }).refine((v) => v.end_line >= v.start_line, { path: ['end_line'] }) })` — a plain `z.object` strips the further keys, which is "accepted and not used".
   - `EvalCaseTryResult = z.object({ status: EvalOutcomeStatus, matched: z.number().int(), findings: z.array(EvalOutcomeFinding), error: z.string().max(500).nullable(), duration_ms: z.number().int(), cost_usd: z.number().nullable() })`
   - Each gets a same-named `export type`.
2. The dashboard fields are NOT added here; they would break `EV/service.ts` and the client fixtures (stage 10).
Skills: `zod` → `SKILL.md`; `onion-architecture` → `rules/zod-contracts.md` § "Both copies must change", § "Naming and casing".
Tests to add: `server/test/eval-contracts.test.ts` — each new schema parses one valid value; `EvalCaseTryInput` rejects a blank diff and `end_line < start_line`, and drops `severity` from `expected_output` (NFR-7, NFR-5).
Done when: `diff -u server/src/vendor/shared/contracts/eval.ts client/src/vendor/shared/contracts/eval.ts` prints nothing; `.claude/agents/scripts/check-code.sh server -- eval-contracts` is green.

### Stage 2 — Draft read and Save-with-body from a finding (P1, server)
Track: server · After: 1
Files: `EV/routes.ts`, `EV/service.ts`, `EV/helpers.ts`, `server/test/eval-case-draft.it.test.ts` (New), `server/test/eval-cases.it.test.ts`, `server/test/eval-case-create.it.test.ts`, `server/test/eval-runs.it.test.ts`, `server/test/helpers/eval.ts`
Read first: `EV/routes.ts`; `EV/service.ts:45-125,375-395`; `EV/helpers.ts:37-120,188-217,278-293`; `EV/types.ts:131-214`; `server/test/eval-cases.it.test.ts:100-300` — the fixtures and the body-less helper at `:127`; `server/test/helpers/eval.ts`; `server/src/modules/reviews/service.ts:190-226` — what `findingOrigin` and `diffForPull` return.
Steps:
1. `EV/helpers.ts`: add pure `buildCaseDraft(origin: EvalFindingOrigin, type: StoredExpectationType, pullDiffRaw: string): EvalCaseDraft`.
   - `name` = `evalCaseName(type, title)`.
   - `fileDiff = extractFileDiff(raw, file)`. When null: `input_diff: ''`, `problem: 'file_not_in_diff'`.
   - Otherwise `input_diff: fileDiff` and `problem` = `expectationInsideDiff(parseUnifiedDiff(fileDiff), place) ? null : 'lines_outside_diff'`.
   - `input_meta` comes from `origin.pull`; `expected_output` is the six finding values.
2. `EV/service.ts`: add private `findingTarget(workspaceId, findingId)` holding the one check order both routes share:
   1. `findingOrigin` missing → `NotFoundError('Finding not found')`.
   2. `findCaseBySourceFinding` hit → return `{ existing }`.
   3. `expectationTypeOf` null → `AppError(finding_undecided, …, 400)`.
   4. Owner (`origin.agentId` → `agents.getById`) missing → `AppError(eval_owner_missing, …, 400)`.
   5. Return `{ origin, expectationType, owner }`.
3. Add `draftFromFinding(workspaceId, findingId): Promise<EvalCaseDraftResponse>`.
   - Existing case: `agent` = `agents.getById(workspaceId, existing.ownerId)` (id and name; `eval_owner_missing` if absent, which is unreachable — see §0). `case` = `toCaseDto(existing, lastResultFor(existing.id, await store.listDoneRunsForAgent(workspaceId, existing.ownerId, EVAL_RUN_LIST_LIMIT), existing.revision))`. `draft: null`.
   - Otherwise: `diffForPull` → `buildCaseDraft`, `case: null`.
   - No store write and no `llm` call.
4. Change `createCaseFromFinding(workspaceId, findingId, input: EvalCaseUpdateInput)`.
   - `findingTarget`; existing → `{ case: toCaseDto(existing, null), created: false }`, as today.
   - Otherwise `diff = this.checkCaseInput(input)`, then `insertCase` with:
     - `name`, `inputDiff`, `expectedOutput` from the body;
     - `inputFiles: caseDiffFiles(diff)`;
     - `inputMeta: { prNumber: pull.number, prTitle: input.input_meta.pr_title, prAuthor: pull.author, prBody: input.input_meta.pr_body }`;
     - `expectationType` from the decision;
     - `sourceFindingId`.
   - Remove the `diffForPull` / `extractFileDiff` block from this method.
5. `EV/routes.ts`:
   - New `GET /findings/:id/eval-case-draft` with `{ schema: { params: IdParams, response: { 200: EvalCaseDraftResponse } } }`.
   - `POST /findings/:id/eval-case` gains `body: EvalCaseUpdateInput` and passes `req.body`.
6. Tests that POST without a body:
   - Add `findingCaseBody(app, findingId): Promise<Record<string, unknown>>` to `server/test/helpers/eval.ts`. It reads the draft route and returns `{ name, input_diff, input_meta: { pr_title, pr_body }, expected_output }`.
   - Use it at `eval-cases.it.test.ts:127`, `eval-case-create.it.test.ts:280` and `eval-runs.it.test.ts:299`.
   - In `eval-cases.it.test.ts`, rewrite only the tests of the replaced SPEC-03 criteria (`:161-294`: SPEC-03 AC-1…6, 8, 10 and the "body is never stored" case) as AC-23…AC-30 of this spec. Every other test stays as it is (NFR-8).
Skills: `onion-architecture` → `rules/fastify-transport.md` § "A route does exactly four things", `rules/errors.md` § "Three rules", `rules/testing.md` § "The suffix routes the CI lane"; `fastify-best-practices` → `rules/testing.md` § "Using inject()"; `zod` → `SKILL.md`; `security` → `checklists.md` (params and body schemas, workspace scoping — NFR-5).
Tests to add:
- `server/test/eval-case-draft.it.test.ts` — AC-12 (accepted and dismissed), AC-14 (three-file PR), AC-15, AC-16 and NFR-1 (row counts of `eval_cases` / `eval_runs` and mock calls unchanged), AC-17, AC-18, AC-19, AC-20 (with a completed run), AC-21, AC-22, NFR-5 (non-uuid → 422), NFR-9 / EC-19 (a row from `insertFindingBornCase` comes back as `case`).
- `server/test/eval-cases.it.test.ts` — AC-23, AC-24, AC-25, AC-26 (two bodies, the first kept), AC-27 (no body; blank `name`), AC-28, AC-29, AC-30, NFR-5 (`file` of `'; drop table eval_cases; --` read back; a 1,100,000-byte body stores nothing).
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval-` is green and the report says the `.it` suites ran (Docker), not skipped.

### Stage 3 — The try route (P1, server)
Track: server · After: 2
Files: `EV/routes.ts`, `EV/service.ts`, `EV/runner.ts`, `EV/helpers.ts`, `server/test/eval-case-try.it.test.ts` (New), `server/test/eval-helpers.test.ts`
Read first: `EV/runner.ts`; `EV/service.ts:230-290,375-395`; `EV/helpers.ts:143-175`; `EV/scoring.ts`; `server/test/eval-helpers.test.ts:140-235` — `assemble()` over `assemblePrompt`; `server/test/eval-runs.it.test.ts:100-120,249-275,375-385,556-592` — the scripted LLM, the provider-less app and the rate-limit config assertion.
Steps:
1. `EV/helpers.ts`: narrow `buildCaseReviewInput`'s third parameter to `Pick<StoredCase, 'inputDiff' | 'inputMeta'>`. Body unchanged; this is the one prompt assembly for a run and a try (NFR-4, AC-41).
2. `EV/runner.ts`: extract the body of the `for` loop into exported `executeCase(job: { agent: EvalAgentRecord; skills: PromptSkill[]; llm: LLMProvider; sessionId: string }, content: { inputDiff: string; inputMeta: StoredInputMeta; expectationType: StoredExpectationType; expectation: LineRange }): Promise<{ tally: CaseTally; findings: StoredFindingRef[]; error: string | null; tokensIn: number; tokensOut: number; costUsd: number | null; durationMs: number }>`.
   - It never throws. A caught error gives `errorTally`, no finding, and the message cut to `ERROR_MESSAGE_MAX`.
   - `executeEvalRun` calls it per case with `sessionId: \`eval:${run.id}\``. It adds tokens and cost only when `error === null`, so the stored run is byte-for-byte what it is today (NG-6).
3. `EV/service.ts`: add `tryCase(workspaceId, agentId, input: EvalCaseTryInput): Promise<EvalCaseTryResult>`, in this order:
   1. `agents.getById` → `NotFoundError('Agent not found')`.
   2. `checkCaseInput(input)` — widen its parameter to `{ input_diff: string; expected_output: { file: string; start_line: number; end_line: number } }`.
   3. `deps.llm(provider)` in the `try/catch` of `startRun` → `AppError(eval_provider_unavailable, …, 400)`.
   4. `skills.linkedEnabled(agent.id)`.
   5. `executeCase` with `sessionId: \`eval-try:${agent.id}\``.
   6. One `deps.log.info({ agentId, agentVersion, status, matched, findingsProduced: tally.produced, findingsGrounded: findings.length, tokensIn, tokensOut, costUsd, durationMs }, 'eval case tried')`.
   7. The DTO: `error` and `cost_usd: null` on `error`, `findings` mapped like `toOutcomeDto` maps them.
   - No `deps.store` call anywhere in the method, and no `findRunningRun` (AC-42, AC-48).
4. `EV/routes.ts`: `POST /agents/:id/eval-cases/try` with `{ schema: { params: IdParams, body: EvalCaseTryInput, response: { 200: EvalCaseTryResult } }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } }`.
Skills: `onion-architecture` → `rules/ports-and-di.md` § "Inject ports, not the container", `rules/fastify-transport.md` § "Validation is declarative", `rules/testing.md`; `fastify-best-practices` → `rules/testing.md`; `security` → `checklists.md` (untrusted text reaches the model only through the engine's blocks; rate limit on the paid route); `zod` → `SKILL.md`.
Tests to add:
- `server/test/eval-helpers.test.ts` — AC-40 (repo intel on: none of the listed sections or values in the assembled input), AC-41 (a stored case and try content with equal values give identical `system` and `user` strings), NFR-4 ("ignore the instructions above" stands inside the diff block; the system message holds neither value).
- `server/test/eval-case-try.it.test.ts` — AC-37, AC-38 (both types), AC-39, AC-42 (six row counts over a pass, a fail and an error), AC-43 (three reads before and after), AC-36 (one draft plus two tries, row contents), AC-44, AC-45, AC-46 (422, `eval_diff_invalid`, `expectation_outside_diff`, mock calls empty), AC-47, AC-48, NFR-2 (one structured call), NFR-3 (route config equals `EVAL_RUN_RATE_LIMIT`), NFR-13 (the log record; the fixture diff's text absent), NFR-5 (oversized body executes nothing).
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval-` is green; `grep -rn "throw new Error(" server/src/modules/eval` prints nothing; `grep -c "^import" server/src/modules/eval/scoring.ts` prints 0.

### Stage 4 — Move the case editor dialog to the cross-route tier (P1, client)
Track: client · After: 1
Files: `CE/{CaseEditorDialog.tsx,CaseEditorDialog.test.tsx,helpers.ts,helpers.test.ts,constants.ts,styles.ts,index.ts}` (moved from `ET/_components/CaseEditorDialog/`), `client/src/components/eval-runs/{helpers.ts,helpers.test.ts,index.ts}`, `ET/EvalsTab.tsx`, `ET/_components/CaseList/CaseList.tsx`, `ET/helpers.ts` and `ET/helpers.test.ts` (deleted)
Read first: `ET/_components/CaseEditorDialog/index.ts` and the import block of `CaseEditorDialog.tsx:7-27` and `CaseEditorDialog.test.tsx:1-20`; `ET/helpers.ts`, `ET/helpers.test.ts`; `client/src/components/confirm-dialog/index.ts` — the flat cross-route folder shape; `client/src/components/eval-runs/index.ts`.
Steps (move only: no prop, behaviour or copy change):
1. `mv` the seven files into `CE/` (flat, like `confirm-dialog/`).
2. Move `expectedCount` and its test cases into `client/src/components/eval-runs/helpers.ts` / `helpers.test.ts` and export it from `eval-runs/index.ts`. Delete `ET/helpers.ts` and `ET/helpers.test.ts`.
3. Update importers:
   - `ET/EvalsTab.tsx` → `@/components/eval-case-editor`;
   - `ET/_components/CaseList/CaseList.tsx` and `CE/CaseEditorDialog.tsx` → `expectedCount` from `@/components/eval-runs`;
   - the relative `messages/en/*.json` import in the moved test → the new depth.
Skills: `frontend-ui-architecture` → `placement.md` § "The ladder" step 3 (a second route renders it), § "The component folder"; `react-testing-library` → `SKILL.md`.
Tests to add: none; the moved suites are the check.
Done when: `.claude/agents/scripts/check-code.sh client` is green with 645 tests (72 files when the helper tests are merged); `grep -rn "_components/CaseEditorDialog" client/src` prints nothing.

### Stage 5 — Client data layer and the P1 copy (P1, client)
Track: client · After: 4
Files: `client/src/lib/api.ts`, `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/evals.test.tsx`, `client/messages/en/eval.json`, `client/messages/en/prReview.json`
Read first: `client/src/lib/api.ts:21-74`; `client/src/lib/hooks/evals.ts:1-66`; `client/src/lib/hooks/evals.test.tsx:1-40,180-200`; `client/messages/en/eval.json:47-97`; `client/messages/en/prReview.json:13-21`.
Steps:
1. `api.ts`: split `apiFetch` so the status is reachable.
   - Add `apiFetchWithStatus<T>(path, init): Promise<{ status: number; data: T }>` (the existing body).
   - `apiFetch` returns its `.data`.
   - Add `api.postWithStatus<T>(path, body?)`.
2. `hooks/evals.ts`:
   - `useEvalCaseDraft()` — `useMutation`, `mutationFn: (findingId: string) => api.get<EvalCaseDraftResponse>(\`/findings/${findingId}/eval-case-draft\`)`, `meta: { inlineError: true }`. A click-time read, never cached.
   - Replace `useCreateEvalCase` with `useSaveEvalCaseFromFinding()` — `mutationFn: ({ findingId, body }: { findingId: string; body: EvalCaseUpdateInput })` → `postWithStatus<EvalCase>` → `{ case: data, created: status === 201 }`. `onSuccess` invalidates `evalKeys.cases(case.owner_id)`.
   - `useTryEvalCase(agentId: string)` — `mutationFn: (body: EvalCaseTryInput) => api.post<EvalCaseTryResult>(\`/agents/${agentId}/eval-cases/try\`, body)`, `meta: { inlineError: true }`, no invalidation.
3. `eval.json`, under `caseEditor`. Reuse `runCase`, `running`, `evalsTab.expectedGot`, `runs.noValue`; leave `resultSummary` unused (DR-22). New keys, worded from the criterion:
   - `runCaseTitle` (AC-60);
   - `try.regionLabel`, `try.passed`, `try.failed`, `try.duration` (`{seconds, number}s`), `try.noFindings`, `try.findings` (ICU plural of `{count, number}`), `try.stale` (AC-56);
   - `problem.fileNotInDiff` (AC-10), `problem.linesOutsideDiff` (AC-11).
4. `prReview.json`, under `finding.evalCase`: add `loading` (AC-5) and `alreadyExists` (AC-33); `createdMustFind`, `createdMustNotFlag` and `openEvals` stay.
Skills: `frontend-ui-architecture` → `logic.md` § "The API layer", § "Hooks are the seam"; `react-best-practices` → `SKILL.md`; `react-testing-library` → `SKILL.md`.
Tests to add: `client/src/lib/hooks/evals.test.tsx` — the draft hook sends one `GET` (AC-4); the save hook sends the body and maps 201 / 200 to `created` (AC-31, AC-33); the try hook posts the body and invalidates nothing (NFR-1). The `useCreateEvalCase` block is replaced.
Done when: `.claude/agents/scripts/check-code.sh client -- evals.test` is green. `EvalCaseAction.tsx` no longer compiles against the removed hook until stage 7 — expected inside this track; the whole-package check is stage 7's.

### Stage 6 — The modal: from-a-finding mode, Run case, the result region (P1, client)
Track: client · After: 5
Files: `CE/CaseEditorDialog.tsx`, `CE/CaseEditorDialog.test.tsx`, `CE/helpers.ts`, `CE/helpers.test.ts`, `CE/styles.ts`, `CE/index.ts`, `CE/TryResult/{TryResult.tsx,TryResult.test.tsx,styles.ts,index.ts}` (New)
Read first: `CE/CaseEditorDialog.tsx`; `CE/helpers.ts:52-165`; `CE/CaseEditorDialog.test.tsx` (harness and the Escape / discard tests); `client/src/components/run-cost/helpers.ts:10-16` — `formatUsd` (null → the no-cost mark); `ET/_components/CaseList/CaseList.tsx:124-150` — the pass / fail / error marks to mirror.
Steps:
1. Props: `{ agent: { id: string; name: string }; evalCase: EvalCase | null; source?: { findingId: string; draft: EvalCaseDraft }; onClose: () => void; onSaved?: (saved: { case: EvalCase; created: boolean }) => void }`. Mode = `source ? "finding" : evalCase ? "edit" : "new"`.
2. `helpers.ts`:
   - `initialValuesFromDraft(draft): FormValues`;
   - `tryMeta(evalCase, draft): { pr_number: number | null; pr_author: string | null }` (draft → stored case → nulls);
   - `toTryBody(values, meta): EvalCaseTryInput` — `expected_output` holds only `file`, `start_line`, `end_line`; `pr_body` follows the `toCreateBody` rule.
3. Finding mode:
   - title `caseEditor.newCase`;
   - the type as text (the branch `evalCase ?` becomes `mode !== "new"`) — AC-7;
   - `draft.problem` rendered as `role="status"` above the Diff field (AC-10, AC-11);
   - Save → `useSaveEvalCaseFromFinding().mutate({ findingId, body: toUpdateBody(values, initial) }, { onSuccess: (saved) => { onSaved?.(saved); onClose(); } })`;
   - `error` and `pending` read from the mode's mutation (AC-34).
4. Run case:
   - `<Button>` between Cancel and Save, `title={t("caseEditor.runCaseTitle")}`, `disabled={!canSave(values) || tryCase.isPending}`, label `caseEditor.running` while pending.
   - On click: `setSent(JSON.stringify(body))`, then `tryCase.mutate(body)` with `useTryEvalCase(agent.id)`.
   - `stale = tryCase.data && sent !== JSON.stringify(toTryBody(values, meta))` (AC-56: a name change is not in the body).
   - The fields stay editable (AC-52). The last-run banner is untouched (AC-59).
5. `TryResult` props: `{ result: EvalCaseTryResult | null; error: Error | null; expectationType: EvalExpectationType; stale?: boolean; compact?: boolean; label?: string }`.
   - Container `role="status"` `aria-live="polite"` `aria-label={t("caseEditor.try.regionLabel")}`.
   - Pass / fail: icon + word + `evalsTab.expectedGot` (N from `expectedCount`) + `try.duration` (`duration_ms / 1000`) + `formatUsd(cost_usd)`.
   - `status: error` and a request error render inside `role="alert"`.
   - The findings list (`file:start–end`, severity as text, title) or `try.noFindings`; skipped when `compact`.
   - Every value is a text node (NFR-6).
   - Grid tracks `minmax(0, 1fr)`, `overflowWrap: "anywhere"`.
6. Export `TryResult` and the prop types from `CE/index.ts`.
Skills: `react-best-practices` → `SKILL.md` (derive `stale` in render, no effect); `frontend-ui-architecture` → `placement.md` § "Sub-component ownership", `logic.md` § "The four kinds of state"; `react-testing-library` → `SKILL.md`.
Tests to add:
- `CE/CaseEditorDialog.test.tsx` — AC-6, AC-7, AC-10, AC-11 (the dialog rendered with `source`), AC-31, AC-34, AC-35 (edits plus one Run case, then Cancel and discard: no `POST` / `PUT` save request), AC-49 (three modes), AC-50, AC-51, AC-52, AC-55 (200 `error`, 400, 429), AC-56, AC-57, AC-58, AC-59, AC-60 (modal), NFR-1 (open and type: no `POST`), NFR-6 (`<img …>` in a draft name), NFR-11 (live region text after a result).
- `CE/TryResult/TryResult.test.tsx` — AC-53 (pass 1 / 1800 ms / 0.02; fail; null cost), AC-54 (two findings; none), EC-30, NFR-6.
- `CE/helpers.test.ts` — `toTryBody`, `initialValuesFromDraft`.
Done when: `.claude/agents/scripts/check-code.sh client -- CaseEditorDialog.test TryResult.test helpers.test` is green (compare `Test Files N` with the suites meant).

### Stage 7 — The finding card opens the modal (P1, client)
Track: client · After: 6
Files: `PR/FindingCard/_components/EvalCaseAction/{EvalCaseAction.tsx,EvalCaseAction.test.tsx,styles.ts}`, `PR/FindingsPanel/FindingsPanel.tsx`, `PR/FindingsPanel/FindingsPanel.test.tsx`, `PR/FindingCard/FindingCard.test.tsx`, `PR/DiffTab/DiffTab.test.tsx`
Read first: `PR/FindingCard/_components/EvalCaseAction/EvalCaseAction.tsx` and its test `:1-140`; `PR/FindingCard/FindingCard.tsx:95-116`; `PR/FindingsPanel/FindingsPanel.tsx:55-68` — the `window` keydown handler; `client/src/vendor/ui/kit/Modal.tsx:15-30` — inline, `position: fixed`; `client/docs/findings-surfaces.md`.
Steps:
1. `EvalCaseAction` state: `draft = useEvalCaseDraft()`, `opened: EvalCaseDraftResponse | null`, `saved: { case: EvalCase; created: boolean } | null`.
   - Click → `draft.mutate(finding.id, { onSuccess: setOpened })`.
   - The button is `disabled={!decided || draft.isPending}`; while pending a `role="status"` `finding.evalCase.loading` (AC-5).
   - `draft.isError` → `role="alert"` with the API message, no dialog (AC-8).
   - The title / hint / `aria-describedby` logic stays (AC-1…AC-3).
2. `opened` → `createPortal(<CaseEditorDialog key={finding.id} agent={opened.agent} evalCase={opened.case} source={opened.draft ? { findingId: finding.id, draft: opened.draft } : undefined} onClose={() => setOpened(null)} onSaved={setSaved} />, document.body)`. The portal keeps the fixed overlay out of the card's stacking and overflow context.
3. When `!opened && saved`:
   - `created` → `createdMustFind` / `createdMustNotFlag` by `saved.case.expectation_type` (AC-32, EC-3);
   - otherwise `alreadyExists` (AC-33);
   - both with the `Link` to `/agents/${saved.case.owner_id}?tab=evals`, in `role="status"`.
4. `FindingsPanel.tsx` handler: return early when `tag === "SELECT"` or `(e.target as HTMLElement | null)?.closest?.('[role="dialog"]')`. Otherwise a letter typed in the modal's selects accepts or dismisses the focused finding behind it.
5. Give `FindingCard.test.tsx` a `QueryClientProvider`, as `FindingsPanel.test.tsx` and `DiffTab.test.tsx` have; fix whatever the three suites assert about the old one-click request.
Skills: `react-best-practices` → `SKILL.md`; `frontend-ui-architecture` → `placement.md` § "Sub-component ownership", `boundaries.md`; `react-testing-library` → `SKILL.md`; `security` → `checklists.md` (no raw HTML; API messages as text).
Tests to add:
- `EvalCaseAction.test.tsx` — AC-1, AC-2, AC-3 (kept), AC-4 (one `GET`, no other method), AC-5 (second click sends nothing), AC-6 (fields equal the mocked draft, through the card), AC-8 (`eval_owner_missing`), AC-9 (`case` set → edit title and stored values), AC-32 (text and `href` with `tab=evals`), AC-33 (200 → text and link, no try request), NFR-11 (focus returns to the control after close).
- `FindingsPanel.test.tsx` — a keydown `a` with a dialog `select` as target sends no action request.
Done when: `.claude/agents/scripts/check-code.sh client` is green (whole package: 645 plus the new tests, no failure); `grep -rn "useCreateEvalCase" client/src` prints nothing.

### Stage 8 — P1 gate (CALLING SESSION)
Track: calling session · After: 3, 7
Files: `specs/fixtures/eval-pipeline/*.png` (New); nothing else in the repository
Read first: `specs/2026-10-12-eval-pipeline-plan.md:786-801` — the tsc and build-on-a-copy recipes; `INSIGHTS.md:40-47`.
Steps:
1. tsc over the server tests: the `/tmp/tsconfig.eval-tests.json` of that stage's step 2, unchanged (the `server/test/eval-*.ts` glob covers the new files). Expected: exit 0, no output.
2. `next build` on a copy (that stage's step 3). Expected: `/eval`, `/eval/[agentId]` and the PR route build; no `Can't resolve ./contracts/…js`.
3. Run the §6 rows marked P1.
4. Live check on the dev stack (already running; any save under `server/src` restarted the API).
   1. Take `pg_dump -Fc` of `devdigest` first.
   2. Record counts: `docker exec devdigest-postgres psql -U devdigest -d devdigest -Atc "select (select count(*) from eval_cases),(select count(*) from eval_runs),(select count(*) from reviews),(select count(*) from findings),(select count(*) from agent_runs),(select count(*) from run_traces)"` (expected to start `8|4|…`).
   3. Pick a decided finding without a case whose review agent is on `deepseek/deepseek-v4-flash`. Find it by `findings` ⋈ `reviews` ⋈ `agents` with `not exists (select 1 from eval_cases c where c.source_finding_id = f.id)`. Change no agent's model.
   4. `agent-browser open` the PR, press "Turn into eval case", screenshot the prefilled modal.
   5. Run case once (the one paid call), screenshot the result.
   6. Cancel; the counts must be identical in all six columns.
   7. Open again, Save; `eval_cases` is 9 and the other five are unchanged. Screenshot the card's confirmation and the agent's Evals tab.
   - Screenshots go to `specs/fixtures/eval-pipeline/`. Nothing is deleted from the dev DB.
Skills: none routed (`specs/**` and `/tmp` are outside every lane).
Tests to add: none.
Done when: steps 1–3 are clean and the two count comparisons hold. P1 is shippable here.

### Stage 9 — The P2 copy (P2, client)
Track: p2-shared · After: 8
Files: `client/messages/en/eval.json`
Read first: `client/messages/en/eval.json`.
Steps: add these keys, worded from the criterion. No key is removed.
- `caseEditor.runOnSave` (AC-61).
- `evalsTab.runCase` (`{name}`, the accessible name — AC-66), `evalsTab.runCaseTitle` (AC-60), `evalsTab.trial` (the "trial run, not stored" label — AC-69).
- `dashboard.runAll.{action, disabledHint, dialogTitle, summary, skippedNoCases, skippedRunning, confirm, cancel, started, running}`. `summary` uses ICU plural `{agents, plural, …}` and `{cases, number}` (AC-73…AC-80).
- `runs.compare.promote.{action, current, dialogTitle, dialogBody, confirm, done, unchanged}` with `{version}` / `{from}` (AC-81…AC-87).
Skills: none routed for a JSON catalog (conventions lane; NFR-10).
Tests to add: none.
Done when: `.claude/agents/scripts/check-code.sh client` is green.

### Stage 10 — Dashboard row data: `case_count`, `run_in_progress`, `trend` (P2, server + both contract copies)
Track: p2-shared · After: 9
Files: both `contracts/eval.ts` copies, `EV/{types,repository,service}.ts`, `server/test/eval-dashboard-rows.it.test.ts` (New), `server/test/eval-contracts.test.ts`, `client/src/app/eval/_components/EvalDashboard/EvalDashboard.test.tsx` (fixture only)
Read first: `server/src/vendor/shared/contracts/eval.ts:175-187`; `EV/service.ts:345-368`; `EV/repository.ts:32-55,403-420`; `EV/types.ts:131-159`; `client/src/app/eval/_components/EvalDashboard/EvalDashboard.test.tsx:40-82`.
Steps:
1. Both copies: `EvalDashboardAgent` gains `case_count: z.number().int().nonnegative()`, `run_in_progress: z.boolean()`, `trend: z.array(z.object({ recall: Metric, precision: Metric, citation_accuracy: Metric })).max(20)`.
2. `EvalStore` + `EvalRepository`, one statement each, workspace-filtered, plain objects out:
   - `caseCountsByAgent(workspaceId): Promise<{ agentId: string; count: number }[]>` — group by `owner_id` where `owner_kind = 'agent'`.
   - `runningAgentIds(workspaceId): Promise<string[]>`.
   - `trendPerAgent(workspaceId, perAgent: number): Promise<{ agentId: string; recall: number | null; precision: number | null; citationAccuracy: number | null }[]>` — a `row_number() over (partition by agent_id order by ran_at desc)` subquery over `done` runs, `rn <= perAgent`, returned by agent and `ran_at` ascending.
3. `EvalService.dashboard`: add the three reads to the `Promise.all` (limit `EVAL_RUN_LIST_LIMIT`) and fill the three fields per agent (`0`, `false`, `[]` when absent).
4. Client fixture: add the three fields to the two `AGENTS` entries so the client typecheck stays green.
Skills: `drizzle-orm-patterns` → `SKILL.md` (window function through `sql`, typed columns); `onion-architecture` → `rules/drizzle-persistence.md` § "Row types do not cross the repository boundary", `rules/zod-contracts.md` § "Both copies must change"; `zod` → `SKILL.md`; `fastify-best-practices` → `rules/testing.md`.
Tests to add:
- `server/test/eval-dashboard-rows.it.test.ts` — AC-72 (3 cases and a `running` run; 2 and none; no cases), AC-89 (21 completed runs → the 20 newest ascending; no runs → `[]`), NFR-14 (the count of `EvalRepository` method calls is the same for 1 and for 5 agents; no per-case data), NFR-1 (no mock call).
- `eval-contracts.test.ts` — the three fields parse; 21 trend entries are refused.
Done when: `diff -u` of the two copies prints nothing; `.claude/agents/scripts/check-code.sh --it server -- eval-` and `.claude/agents/scripts/check-code.sh client -- EvalDashboard.test` are green.

### Stage 11 — Run on save (P2, client)
Track: p2-modal · After: 9
Files: `CE/CaseEditorDialog.tsx`, `CE/CaseEditorDialog.test.tsx`, `CE/styles.ts`
Read first: `CE/CaseEditorDialog.tsx` (as stage 6 left it); `CE/helpers.ts` — `toTryBody`, `initialValues`.
Steps:
1. Footer: a native `<input type="checkbox">` in a `<label>` with `caseEditor.runOnSave`, `runOnSave` state default `true` (AC-61).
2. Hold the stored case in state: `current: EvalCase | null` (initial `evalCase`) and `baseline: FormValues` (initial values). Mode, title, the `PUT` id and `isDirty` read `current` / `baseline`.
3. On a successful save (201 create, 201 from a finding, 200 `PUT`):
   - call `onSaved` (finding mode);
   - `runOnSave` → `setCurrent(saved)`, `setBaseline(values)`, send one try with `toTryBody(values, meta)`, stay open (AC-62, AC-63);
   - otherwise → `onClose()` (AC-64).
4. A save from a finding answering 200 (`created: false`) → `onSaved`, `onClose()`, no try (AC-33, EC-14). A failed save sends no try (AC-65).
Skills: `react-best-practices` → `SKILL.md`; `frontend-ui-architecture` → `logic.md` § "The four kinds of state"; `react-testing-library` → `SKILL.md`.
Tests to add: `CE/CaseEditorDialog.test.tsx` — AC-61 (three modes, checked), AC-62 (exactly one try after a save, per mode), AC-63 (a second Save is a `PUT` to the stored id), AC-64, AC-65, EC-13 (the try errors: the case stays, edit mode, the error shows), EC-14.
Done when: `.claude/agents/scripts/check-code.sh client -- CaseEditorDialog.test` is green.

### Stage 12 — The run control on a case row (P2, client)
Track: p2-rows · After: 9
Files: `ET/_components/CaseList/{CaseList.tsx,CaseList.test.tsx,styles.ts}`, `ET/EvalsTab.tsx`
Read first: `ET/_components/CaseList/CaseList.tsx`; `ET/_components/CaseList/styles.ts`; `ET/EvalsTab.tsx:90-102`; `CE/TryResult/TryResult.tsx`; `CE/helpers.ts` — `toTryBody`'s shape.
Steps:
1. `CaseList` gains `listStamp?: number`; `EvalsTab` passes `cases.dataUpdatedAt`. `CaseRow` is keyed `${c.id}:${listStamp}`, so a re-read list drops every trial result (AC-70).
2. `CaseRow` calls `useTryEvalCase(agentId)`.
   - A native `<button>` before the edit control, `aria-label={t("evalsTab.runCase", { name })}`, `title={t("evalsTab.runCaseTitle")}`, `disabled={tryCase.isPending}`, a running text while pending (AC-66, AC-68, AC-60).
   - The body is built from the stored case: `expectation_type`, `input_diff`, the four `input_meta` values, `expected_output` file and lines (AC-67).
3. Under the row's stored result: `<TryResult compact label={t("evalsTab.trial")} result={tryCase.data ?? null} error={tryCase.error} expectationType={item.expectation_type} />`. `CaseResult` is unchanged (AC-69, AC-71).
4. Keep the row's `flexWrap` / `minWidth: 0` rules for the added line.
Skills: `react-best-practices` → `SKILL.md`; `frontend-ui-architecture` → `placement.md` § "The ladder"; `react-testing-library` → `SKILL.md`.
Tests to add: `CaseList.test.tsx` — AC-66, AC-67 (the body equals the row's case; no other write), AC-68 (one of two rows pending), AC-69 ("never run" stays beside the trial result), AC-70 (a new `listStamp` removes it), AC-71, AC-60 (title), NFR-11 (live region, native button).
Done when: `.claude/agents/scripts/check-code.sh client -- CaseList.test EvalsTab.test` is green.

### Stage 13 — Run all agents (P2, client)
Track: p2-dashboard · After: 9, 10
Files: `client/src/app/eval/_components/EvalDashboard/{EvalDashboard.tsx,EvalDashboard.test.tsx,styles.ts}`, `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/evals.test.tsx`
Read first: `client/src/app/eval/_components/EvalDashboard/EvalDashboard.tsx:33-110`; its test `:40-90`; `client/src/lib/hooks/evals.ts:113-155`; `client/src/components/confirm-dialog/ConfirmDialog.tsx:14-45`.
Steps:
1. `hooks/evals.ts`:
   - `useEvalDashboard` gains `refetchInterval: (q) => (q.state.data?.agents.some((a) => a.run_in_progress) ? EVAL_RUN_POLL_MS : false)` (AC-80).
   - New `useStartEvalRunsForAgents()` — `mutationFn: (agentIds: string[]) => Promise.allSettled(agentIds.map((id) => api.post<EvalRun>(\`/agents/${id}/eval-runs\`)))` mapped to `{ agentId, ok: boolean, message: string | null }[]`. `onSettled` invalidates `evalKeys.dashboard()` and each `evalKeys.runs(id)`.
2. Dashboard header: a native button `dashboard.runAll.action`.
   - `eligible = agents.filter((a) => a.case_count > 0 && !a.run_in_progress)`.
   - Disabled, with `aria-describedby` on the hint, when `eligible.length === 0` or the mutation is pending (AC-73, AC-74, AC-79).
3. Click → `ConfirmDialog` with `danger={false}`: `summary` (agents and the sum of `case_count`), the names left out for no case and for a run in progress, as text (AC-75, NFR-6). Confirm → `mutate(eligible ids)` (AC-76). Cancel / Escape send nothing (AC-78).
4. Per row, from the mutation result or the response: `started`, the API message, or `running` when `run_in_progress` (AC-77, AC-80). The row is a `Link`, so this is a text node inside it, not a nested control.
Skills: `react-best-practices` → `SKILL.md`; `frontend-ui-architecture` → `logic.md` § "Hooks are the seam"; `react-testing-library` → `SKILL.md`.
Tests to add:
- `EvalDashboard.test.tsx` — AC-73, AC-74 (no cases; empty list), AC-75 (8 / 3 / 0 → "2 agents", "11", the third name; no request), AC-76, AC-77 (one 202, one 400), AC-78 (Cancel, Escape), AC-79, AC-80 (`run_in_progress` true → false swaps the state without a reload; repeat `staleTime` when counting requests).
- `evals.test.tsx` — the per-agent result mapping.
Done when: `.claude/agents/scripts/check-code.sh client -- EvalDashboard.test evals.test` is green.

### Stage 14 — The sparkline on a dashboard row (P2, client)
Track: p2-dashboard · After: 10 (13 only because both write `EvalDashboard.tsx`)
Files: `client/src/app/eval/_components/EvalDashboard/{EvalDashboard.tsx,EvalDashboard.test.tsx,styles.ts}`
Read first: `client/src/components/eval-runs/MetricTiles/MetricTiles.tsx:40-50` — the `aria-hidden` `data-sparkline` wrapper to mirror; `client/src/vendor/ui/charts/Sparkline.tsx`; `client/src/components/eval-runs/helpers.ts:54-70`.
Steps: in the row, `const recall = agent.trend.map((p) => p.recall).filter((v): v is number => v !== null)`. When `recall.length >= 2`, render `<span aria-hidden="true" data-sparkline="recall"><Sparkline data={recall} color="var(--accent)" w={64} h={20} /></span>` before the metrics; otherwise nothing.
Skills: `react-best-practices` → `SKILL.md`; `react-testing-library` → `SKILL.md`.
Tests to add: `EvalDashboard.test.tsx` — AC-90 (three entries → one `[data-sparkline]`), AC-91 (one run; three null recalls), NFR-12 (the wrapper is `aria-hidden`; no `img` role added).
Done when: `.claude/agents/scripts/check-code.sh client -- EvalDashboard.test` is green.

### Stage 15 — Promote vN (P2, client + one server test) — WAITS for F1
Track: p2-promote · After: 9
Files: `client/src/components/eval-runs/RunHistory/_components/CompareRunsDialog/{CompareRunsDialog.tsx,CompareRunsDialog.test.tsx,styles.ts}`, `client/src/lib/hooks/agents.ts`, `server/test/eval-promote.it.test.ts` (New)
Read first: `CompareRunsDialog.tsx:21-100`; its test harness; `client/src/lib/hooks/agents.ts:22-28,52-78`; `server/src/modules/agents/routes.ts:46-57,108-143`; `server/src/modules/agents/helpers.ts:64-89`; `server/test/agents-versions.it.test.ts` — the fixture pattern.
Steps (planned up to the gap; the equal-configuration outcome is F1):
1. `hooks/agents.ts`: `usePromoteAgentVersion(agentId)` — `mutationFn: async (version: number)` reads `api.get<AgentVersion>(\`/agents/${agentId}/versions/${version}\`)`, then `api.put<Agent>(\`/agents/${agentId}\`, { provider, model, system_prompt, strategy, output_schema, ci_fail_on, repo_intel })` from `config`. No skills call (OQ-1 default). `meta: { inlineError: true }`. `onSuccess` as `useUpdateAgent`.
2. `CompareRunsDialog`: `useAgent(agentId)`; with `data` and the agent loaded, in the footer before Close:
   - `head.agent_version !== agent.version` → a native button `promote.action` with `{ version: head.agent_version }` (AC-81);
   - otherwise the button disabled with `promote.current` as its description (AC-82).
   - Click → `ConfirmDialog danger={false}` with `promote.dialogBody` (AC-83).
   - Confirm → `mutate(head.agent_version)` (AC-84).
   - Answer with a higher `version` → `promote.done` in place of the control (AC-86); the same version → `promote.unchanged` (AC-87).
   - Error → `role="alert"` with the message, control enabled (AC-88).
   - Extend the existing Tab trap to the new controls; the confirmation returns focus to the Promote control.
Skills: `react-best-practices` → `SKILL.md`; `frontend-ui-architecture` → `logic.md` § "The API layer"; `react-testing-library` → `SKILL.md`; `onion-architecture` → `rules/testing.md`; `fastify-best-practices` → `rules/testing.md`.
Tests to add:
- `CompareRunsDialog.test.tsx` — AC-81, AC-82, AC-83 (no `PUT`), AC-84 (the body equals the seven snapshot values; no skills request), AC-86, AC-87, AC-88 (404 on the snapshot read), NFR-11.
- `server/test/eval-promote.it.test.ts` — AC-85 (an agent made through `POST /agents` and two `PUT`s, at version 3, sent version 1's configuration, reads version 4; the rows of versions 1–3 are identical before and after), EC-28.
Done when: `.claude/agents/scripts/check-code.sh client -- CompareRunsDialog.test` and `.claude/agents/scripts/check-code.sh --it server -- eval-promote` are green.

### Stage 16 — Final gate (CALLING SESSION)
Track: calling session · After: whichever of 10–15 landed
Files: `specs/fixtures/eval-pipeline/*.png`; `docs/**` by the calling session, outside this plan
Steps:
1. Repeat stage 8 steps 1–3 with every §6 row.
2. Headless screenshots of the P2 surfaces that landed, with no paid call: the modal footer with the toggle (switch it off before any Save), a case row's run control, the "Run all agents" dialog then Cancel, the row sparkline, the Promote control then Cancel.
3. `git status --short reviewer-core server/src/db/migrations` shows no file of this feature (NFR-8, NFR-9).
4. Documentation handoff — `docs/eval-pipeline.md` sections that describe the old flow (named from the headings; the body was not read for this plan):
   - § "Using it" (`:98`) with § "Editing a case" (`:129`) — the one-click flow, no Run case;
   - § "Routes" (`:139`) — ten routes; `POST /findings/:id/eval-case` without a body; the dashboard shape;
   - § "Refusals" (`:157`) — a finding outside the diff no longer refuses the click;
   - § "Worked example" (`:183`);
   - § "Known limits" (`:203`) — the per-case run, "Run all agents" and Promote.
   - Also the route tables in `server/README.md § API map` and `client/README.md § UI route map`, and the demo script.
Done when: every §6 row is green and the screenshots exist.

## 5. Skills matrix
| Stage | onion-architecture | fastify-best-practices | zod | security | drizzle-orm-patterns | frontend-ui-architecture | react-best-practices | react-testing-library |
|---|---|---|---|---|---|---|---|---|
| 1 | `rules/zod-contracts.md` | — | `SKILL.md` | — | — | — | — | — |
| 2 | `rules/fastify-transport.md`, `rules/errors.md`, `rules/testing.md` | `rules/testing.md` | `SKILL.md` | `checklists.md` | — | — | — | — |
| 3 | `rules/ports-and-di.md`, `rules/fastify-transport.md`, `rules/testing.md` | `rules/testing.md` | `SKILL.md` | `checklists.md` | — | — | — | — |
| 4 | — | — | — | — | — | `placement.md` | — | `SKILL.md` |
| 5 | — | — | — | — | — | `logic.md` | `SKILL.md` | `SKILL.md` |
| 6 | — | — | — | — | — | `placement.md`, `logic.md` | `SKILL.md` | `SKILL.md` |
| 7 | — | — | — | `checklists.md` | — | `placement.md`, `boundaries.md` | `SKILL.md` | `SKILL.md` |
| 10 | `rules/drizzle-persistence.md`, `rules/zod-contracts.md` | `rules/testing.md` | `SKILL.md` | — | `SKILL.md` | — | — | — |
| 11, 12, 14 | — | — | — | — | — | `logic.md` / `placement.md` | `SKILL.md` | `SKILL.md` |
| 13 | — | — | — | — | — | `logic.md` | `SKILL.md` | `SKILL.md` |
| 15 | `rules/testing.md` | `rules/testing.md` | — | — | — | `logic.md` | `SKILL.md` | `SKILL.md` |

## 6. Verification
| Package | Command (from the repository root) | Proves |
|---|---|---|
| both (P1, P2) | `diff -u server/src/vendor/shared/contracts/eval.ts client/src/vendor/shared/contracts/eval.ts` | NFR-7 — prints nothing |
| server (P1) | `.claude/agents/scripts/check-code.sh server` | typecheck, depcruise, unit lane (≥ 584, no failure): AC-13, AC-40, AC-41, NFR-4, NFR-7 |
| server (P1, P2) | `.claude/agents/scripts/check-code.sh --it server` (Docker) | the `.it` lane (≥ 226): AC-12…30, AC-36…48, NFR-1…3, 5, 9, 13; P2: AC-72, AC-85, AC-89, NFR-14 |
| server (P1, P2) | `cd server && pnpm verify:l06` | the eval suites alone (≥ 197), picking up every new `test/eval-*` file |
| server (P1, P2) | `server/node_modules/.bin/tsc -p /tmp/tsconfig.eval-tests.json` (calling session) | the new server tests type-check — exit 0, no output |
| client (P1, P2) | `.claude/agents/scripts/check-code.sh client` | typecheck with tests, component lane (≥ 645): AC-1…11, 31…35, 49…60; P2: AC-61…71, 73…84, 86…88, 90, 91; NFR-6, 10, 11, 12 |
| client (P1, P2) | `next build` on a `/tmp` copy (calling session) | no value import from `@devdigest/shared`; the routes build |
| mcp (P1) | `.claude/agents/scripts/check-code.sh mcp` | NFR-8 — unchanged, 309 tests |
| repo | `git status --short reviewer-core server/src/db/migrations` | NFR-8, NFR-9 — no file of this feature |
| repo | `grep -rn "throw new Error(" server/src/modules/eval` ; `grep -c "^import" server/src/modules/eval/scoring.ts` | the module conventions — nothing; 0 |
| dev stack (P1) | stage 8 step 4 | Cancel stores nothing; Save stores one case; one paid call |

## 7. Risks and open questions
- [blocking] Execution mode — undecided in the task (question 1).
- [settled 2026-10-13, declared deviation] F1: the API is left as it is — `PUT /agents/:id` with a body that holds `output_schema` always adds a version, so a promotion always answers a higher version and shows `promote.done`. AC-87 / EC-27 ("unchanged") stay in the client as the branch for an answer with the same version and are proven by a mocked test only; no change to the agents module. Stage 15 does not wait.
- F1 as returned: `conflict` EC-27 / AC-87 — "no version is added" for a promotion equal to the current configuration, against `server/src/modules/agents/helpers.ts:87`.
  - `isConfigChange` returns true whenever `outputSchema` is defined. `AgentsService.update` (`server/src/modules/agents/service.ts:112`) forwards `output_schema` whenever the body holds it, `null` included, and AC-84 puts it in every promotion body.
  - So every promotion adds a version, and the server never answers "unchanged" unless the snapshot lacks the key.
  - Changes the plan by: one reading adds a change to `PUT /agents/:id` (the agents module, every caller of the route) and a test; the other leaves the API and makes AC-87 reachable only in a mocked test. Stage 15 waits for the spec.
- [non-blocking] OQ-1 — planned with the default (seven values, skill links untouched); AC-84 keeps its marker.
- [non-blocking] OQ-2 — planned with the default (no deadline for a try).
- [non-blocking] P1 is consistent only as a whole. Between stage 2 and stage 7 the PR-page control answers 422, because the route requires a body while the old client sends none. A cut inside P1 is repaired by finishing the client track, not by reverting.
- [non-blocking] The `FindingsPanel` guard (stage 7 step 4) covers a key event whose target is inside the dialog. A key pressed with focus on `document.body` while the modal is open still reaches the list shortcuts (REC1).
- [non-blocking] Not checked (read-only run):
  - the `SKILL.md` bodies were not re-read in full — rules are cited from `routing.md` and the rule files' section headings;
  - whether Fastify answers 422 (not 400) for a body-less POST against a Zod body schema — AC-27's test decides;
  - whether `@fastify/rate-limit` counts per route — NFR-3 asserts the config only;
  - the `Modal` overlay inside the PR page — the portal in stage 7 and the stage 8 screenshot cover it.
- [non-blocking] `tsx watch` restarts the dev API on each save under `server/src` during stages 2, 3 and 10; no suite runs against the dev API, and the live check comes after.

## 8. Handoff to reviewers
- Architecture:
  - `executeCase` extracted from `executeEvalRun` (`EV/runner.ts`) — the run must stay byte-identical.
  - `buildCaseReviewInput` narrowed to a `Pick`.
  - Three new `EvalStore` methods and the window-function query (stage 10).
  - `CE/` as a new cross-route folder, with `TryResult` exported from it and consumed by the agent route (stage 12).
  - `apiFetchWithStatus` in `client/src/lib/api.ts`.
  - The `FindingsPanel` keydown guard and the portal in `EvalCaseAction`.
- Security:
  - Two new routes and one changed (`GET /findings/:id/eval-case-draft`, `POST /agents/:id/eval-cases/try`, `POST /findings/:id/eval-case` with a body) — workspace scoping, Zod params and body, the body limit.
  - The try route is paid and rate-limited, with author-controlled diff and description reaching the model only through `buildCaseReviewInput` (UI-1…UI-3).
  - The try log line carries no text (NFR-13).
  - Try findings, error messages, draft values and agent names are rendered as text (NFR-6).
  - The promotion sends a stored snapshot back through `PUT /agents/:id` (UI-6).

## 9. Execution
Mode: multi-agent — questions 1–2 answered 2026-10-13 with the recommended options (the user's "take all recommended"). REC1 accepted: the `FindingsPanel` shortcuts are inert while any dialog is open (stage 7 step 4 and its test follow REC1's wording).
Recommended: multi-agent — after stage 1 the server and client tracks write disjoint trees and client tests mock `fetch`; in P2 four tracks are disjoint after stages 9–10.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| shared (P1) | 1 | both `contracts/eval.ts`, `server/test/eval-contracts.test.ts` | — | alone |
| server (P1) | 2–3 | `EV/**`, `server/test/eval-*.ts`, `server/test/helpers/eval.ts` | shared | parallel |
| client (P1) | 4–7 | `CE/**`, `ET/**`, `client/src/components/eval-runs/{helpers.ts,helpers.test.ts,index.ts}`, `client/src/lib/{api.ts,hooks/evals.ts,hooks/evals.test.tsx}`, `client/messages/en/{eval,prReview}.json`, `PR/{FindingCard,FindingsPanel,DiffTab}/**` | shared | parallel |
| gate (P1) | 8 | `specs/fixtures/eval-pipeline/**` | server, client | alone, calling session |
| p2-shared | 9–10 | `client/messages/en/eval.json`, both `contracts/eval.ts`, `EV/{types,repository,service}.ts`, `server/test/eval-{dashboard-rows.it,contracts}.test.ts`, `EvalDashboard.test.tsx` | gate | alone |
| p2-modal | 11 | `CE/{CaseEditorDialog.tsx,CaseEditorDialog.test.tsx,styles.ts}` | p2-shared | parallel |
| p2-rows | 12 | `ET/_components/CaseList/**`, `ET/EvalsTab.tsx` | p2-shared | parallel |
| p2-dashboard | 13, 14 | `client/src/app/eval/_components/EvalDashboard/**`, `client/src/lib/hooks/evals.ts`, `evals.test.tsx` | p2-shared | parallel |
| p2-promote | 15 | `CompareRunsDialog/**`, `client/src/lib/hooks/agents.ts`, `server/test/eval-promote.it.test.ts` | p2-shared, F1 | parallel |
| gate (P2) | 16 | `specs/fixtures/eval-pipeline/**` | all landed | alone, calling session |

Briefs — a fresh `implementer` each, in order inside a track; the plan path is `specs/2026-10-13-eval-case-modal-plan.md`:
- B1 · stage 1 → "Execute stage 1 (track shared). Write only inside: both `vendor/shared/contracts/eval.ts`, `server/test/eval-contracts.test.ts`. Check with: `check-code.sh server -- eval-contracts` and the `diff -u`."
- B2 · stages 2–3 → "Execute stages 2–3 (track server). Write only inside: `server/src/modules/eval/**`, `server/test/eval-*.ts`, `server/test/helpers/eval.ts`. Check with: `check-code.sh --it server -- eval-`."
- B3 · stages 4–5 → "Execute stages 4–5 (track client). Write only inside: `client/src/components/eval-case-editor/**`, the `EvalsTab/**` folder, `client/src/components/eval-runs/{helpers.ts,helpers.test.ts,index.ts}`, `client/src/lib/api.ts`, `client/src/lib/hooks/evals{.ts,.test.tsx}`, `client/messages/en/{eval,prReview}.json`. Move with `mv`. Check with: `check-code.sh client` after stage 4, `check-code.sh client -- evals.test` after stage 5."
- B4 · stage 6 → "Execute stage 6 (track client). Write only inside: `client/src/components/eval-case-editor/**`. A missing message key is reported, not added. Check with: `check-code.sh client -- CaseEditorDialog.test TryResult.test helpers.test`."
- B5 · stage 7 → "Execute stage 7 (track client). Write only inside: `PR/FindingCard/**`, `PR/FindingsPanel/**`, `PR/DiffTab/DiffTab.test.tsx`. A missing message key is reported. Check with: `check-code.sh client`."
- B6 · stages 9–10 → "Execute stages 9–10 (track p2-shared). Write only inside the p2-shared write set. Check with: `check-code.sh --it server -- eval-`, `check-code.sh client`, the `diff -u`."
- B7 · stage 11; B8 · stage 12; B9 · stages 13–14; B10 · stage 15 (only after F1) → "Execute stage <n> (track <track>). Write only inside: <write set of the row>. A missing message key is reported. Check with: the stage's Done-when."

single-agent: the same briefs, one after another, B1 → B10, with stage 8 between B5 and B6; the Runs column is not used.

## 10. Recommendations — not applied
- REC1 [approach] Make the `FindingsPanel` shortcuts inert while any dialog is open, not only for events that start inside one.
  - Why: the handler is on `window` (`PR/FindingsPanel/FindingsPanel.tsx:56-68`) and skips only `INPUT` / `TEXTAREA`; with the modal open and focus on `body`, `a` or `d` changes a finding's decision behind it (EC-3).
  - Would change: stage 7 step 4 and its test; it also changes the shortcuts while the run trace drawer is open, which no criterion covers.

## Questions for the user
The calling session asks these with AskUserQuestion and sends the answers back; the implementer does not start before every [blocking] one is answered.
1. [blocking] Execution mode — multi-agent or single-agent?
   - multi-agent (recommended) — the server track (B2) and the client track (B3–B5) have disjoint write sets after B1 and client tests mock `fetch`; in P2, B7–B10 are disjoint after B6. Same briefs, less wall time.
   - single-agent — the same ten briefs in order; no merge risk, about twice the wall time for P1.
2. [blocking for stage 15 only] Build P2 without Promote while F1 is with `spec-creator`?
   - Yes (recommended) — stages 9–14 do not depend on it; stage 15 is last and starts when the spec answers F1.
   - No — hold all of P2 until F1 is settled.

Recommendations awaiting a decision: REC1 (section 10) — accept before stage 7 starts, or the plan stands as written.
Gaps for `spec-creator`, not questions of mine: F1 (section 7) — it settles EC-27 / AC-87 against `server/src/modules/agents/helpers.ts:87` with the user in the spec; stage 15 waits until then.
