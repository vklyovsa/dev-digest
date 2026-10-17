# Implementation Plan — Skill evals (SPEC-10)
Source: `specs/2026-10-13-skill-evals.md` (Status: approved; `check-spec.sh` ok, 0 blocking, 2 WARN: AC-73 is manual, diagrams not rendered) · Base: `1d4e77f` + the uncommitted SPEC-03…05 and SPEC-09 tree · Packages: server, client, both `@devdigest/shared` copies

No blocking question stands. Three recommendations await a decision (see "Questions for the user" at the end); the plan stands as written without them.

All paths are relative to `/home/klov/emdash/repositories/dev-digest/`. Abbreviations:
- `EV/` = `server/src/modules/eval`
- `ET/` = `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab`
- `SK/` = `client/src/app/skills/_components/SkillDetail`
- `ST/` = `SK/_components/EvalsTab` (New)
- `CE/` = `client/src/components/eval-case-editor`
- `CL/` = `client/src/components/eval-case-list` (New, moved from `ET/_components/CaseList/`)
- `ER/` = `client/src/components/eval-runs`
- `CD/` = `ER/RunHistory/_components/CompareRunsDialog`

## 0. Before the first edit
- `INSIGHTS.md § What Doesn't Work` — "A per-brief filtered check stays green while parallel implementers break each other" → every brief names the other suites it can break; stage 15 runs each package unfiltered; tests look for a request among all `fetchMock.mock.calls`, never `calls.at(-1)`.
- same — "An implementer's token bill is turns × standing context" → ten briefs of one or two stages, `Read first` batched in one message.
- same — "`git grep` passes vacuously for an untracked module" → absence checks use `grep -rn`.
- same — "pr-self-review runs no drizzle/postgres lane on a table edit" → stage 1 applies `drizzle-orm-patterns` and `postgresql-table-design` to `schema/eval.ts` deliberately.
- `INSIGHTS.md § What Works` — "dry run on a restored copy in the SAME container", "list what the user has changed away from the defaults", "diff `agent_runs` / `run_traces`" → stage 2 and stage 16.
- `INSIGHTS.md § Recurring Errors` — `psql -U devdigest -d devdigest`; a stack started by a session dies with it; `agent-browser screenshot` needs an absolute path (§ Tool & Library Notes).
- `server/INSIGHTS.md § Tool & Library Notes` — "`drizzle-kit generate` becomes INTERACTIVE the moment one migration both drops and adds columns" → stage 1 adds columns only, so generation is expected to run unattended; the hand-written fallback with a snapshot is the calling session's (§7).
- same — "`tsx watch` does not restart on `src/vendor/`"; "`pnpm typecheck` does not look at `test/**`" with the `/tmp` tsconfig and `typeRoots` → stage 15 type-checks the new server tests.
- `server/INSIGHTS.md § Codebase Patterns` — "`AgentsRepository.deleteById` deletes the agent's `eval_cases`" (accepted exception; "when `eval_cases` gains skill-owned rows, look in `agents/repository.ts` as well") → stage 7 mirrors it in `SkillsRepository.deleteById`; flagged in §8 and REC3.
- same — "An eval run has no per-case deadline" → NG-11; a hung skill run blocks that skill only (EC-16).
- same — "A seeded agent has no `agent_versions` row for version 1" → tests create agents through `POST /agents` or `insertEvalAgent`; a seeded skill does have its version 1 snapshot (`server/src/db/seed.ts:321`).
- same — "A studio review is ONE LLM call" (mock bills `costUsd` 0.001) → NFR-2 expectations.
- same — "A derived count belongs on the DTO … filled on EVERY read path" → `skill_id` / `skill_version` are set in the one mapper `toRunDto`.
- `server/INSIGHTS.md § Recurring Errors` — "`statusCode` does not exist on `void & Promise<Response>`" → inject payloads typed `Record<string, unknown>`; "`agent_runs.status` turns `done` BEFORE the run trace is stored" → the NFR-5 review check in stage 6 polls the trace.
- `client/INSIGHTS.md § Recurring Errors` — "Evals tab overflowed its pane" → `minmax(0, 1fr)` and `overflowWrap: "anywhere"` in `ST/styles.ts`; AC-73 is a screenshot (stage 16).
- same — "vendored `@devdigest/shared` is TYPE-only" → `import type` only; "blank and unstyled after `pnpm build`" → `next build` on a `/tmp` copy; "`No QueryClient set`" → stage 10 names the PR-page suites; "A vitest hook that RETURNS a function" → block-body `beforeEach`.
- `client/INSIGHTS.md § Tool & Library Notes` — no `user-event` (`fireEvent`); `Tabs` renders plain buttons (read tab order from `parentElement` children); `Modal` renders inline, so `getByRole("dialog")` can find two; `setDefaultOptions` drops `staleTime` when counting requests (AC-39); `{x, number}` for ICU numbers; client `tsc` covers tests with `noUncheckedIndexedAccess`; a vitest filter matches folder names and fails silently on `[segment]` paths.
- Read: the spec § Contracts (`:292-351`), `docs/eval-pipeline.md` § "One run", § "Trying a case", `server/docs/skills-in-prompt.md`, `client/docs/skills-ui.md:25-42`, `TESTING.md § Conventions`.

## 1. Scope — as the source states it
Goal: G-1…G-4 — `specs/2026-10-13-skill-evals.md:36-39`
Non-goals: NG-1…NG-11 — `:41-51`
Acceptance criteria (pointer table; the wording stays in the spec, AC `:88-189`, NFR `:228-241`):

| Criteria | Stage | State |
|---|---|---|
| AC-1…AC-6, AC-8, NFR-6 (case routes), NFR-14 (cases) | 5 | clear |
| AC-7 | 5, 6, 7 (two routes each) | clear |
| AC-9…AC-12, AC-15…AC-21, AC-23…AC-29, NFR-2, NFR-3, NFR-13, NFR-14 (runs) | 6 | clear |
| AC-13, AC-14, NFR-4, NFR-5 | 6 | clear; assembly already there `EV/helpers.ts:201` — tests and the one-skill call only |
| AC-22 | 1 (test only) | already there `EV/repository.ts:395` (the reaper is not owner-scoped) |
| AC-32, NFR-9 | 1, 2 | clear |
| AC-30, AC-31, AC-33, AC-34 | 7 | clear |
| AC-35 | 7 (test only) | already there `server/src/db/schema/eval.ts:86` (cascade), `server/src/modules/agents/repository.ts:77-93` (agent cases only) |
| NFR-8 | 3 | clear |
| NFR-11 | 4, then every client stage | clear |
| AC-36 | 4 (text), 14 (test) | clear |
| AC-52 | 8 | clear |
| AC-42, AC-56, AC-57, AC-58, AC-47 (rows) | 9 | clear; the row is already there `ET/_components/CaseList/CaseList.tsx:92-202` |
| AC-59…AC-64 | 10 | clear |
| AC-67…AC-72 | 11 | clear |
| AC-49, AC-50, AC-51, AC-53, AC-65, AC-66, AC-47 (control) | 12 | clear |
| AC-39, AC-40, AC-41, AC-43…AC-46, AC-48, AC-54, AC-55 | 13 | clear; tiles already there `ER/MetricTiles/MetricTiles.tsx` |
| AC-37, AC-38 | 14 | clear |
| NFR-1 | 5, 6, 7 (integration), 13 (component) | clear |
| NFR-7, NFR-12 | 9, 10, 11, 12, 13 | clear |
| NFR-10 | 15 | clear |
| AC-73 | 16 | manual, as the spec states |

## 2. Impact map
| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| server | `server/src/db/schema/eval.ts` | Modify | schema | NFR-9, AC-18…20 |
| server | `server/src/db/migrations/0019_skill_evals.sql`, `meta/0019_snapshot.json`, `meta/_journal.json` | New / generated | migration | NFR-9 |
| server | `EV/{types,repository,service,routes,runner,helpers,constants}.ts` | Modify | route → service → repository / runner | AC-1…AC-33 |
| server | `server/src/modules/skills/repository.ts` | Modify | repository | AC-34 |
| both | `{server,client}/src/vendor/shared/contracts/eval.ts` | Modify | contract, two copies | NFR-8 |
| server | `server/test/eval-skill-{store,cases,runs,try,compare,delete}.it.test.ts` | New | integration | per stage |
| server | `server/test/{eval-contracts,eval-helpers}.test.ts`, `server/test/helpers/eval.ts` | Modify | tests | NFR-8, AC-13, AC-14 |
| client | `client/messages/en/{eval,skills}.json` | Modify (stage 4 only) | i18n | NFR-11 |
| client | `client/src/lib/hooks/evals.ts`, `evals.test.tsx` | Modify | data layer | AC-50, 52, 56, 61, 62 |
| client | `ER/{helpers.ts,helpers.test.ts,index.ts}` | Modify | cross-route | shared owner types |
| client | `CL/**` (moved from `ET/_components/CaseList/`) | New (move) | cross-route — a second route renders it | AC-42, 56…58 |
| client | `ET/EvalsTab.tsx` | Modify (one import) | route-local | — |
| client | `CE/{CaseEditorDialog.tsx,CaseEditorDialog.test.tsx,index.ts}` | Modify | cross-route | AC-59…64 |
| client | `CD/**` (plus New `helpers.ts`, `helpers.test.ts`) | Modify | cross-route | AC-67…72 |
| client | `ER/RunControl/**`, `ER/RunHistory/{RunHistory.tsx,RunHistory.test.tsx,styles.ts}` | Modify | cross-route | AC-47, 49…53, 65, 66 |
| client | `ST/{EvalsTab.tsx,EvalsTab.test.tsx,helpers.ts,helpers.test.ts,styles.ts,index.ts}` | New | route-local, owned by `SkillDetail` | AC-39…48, 54, 55 |
| client | `SK/SkillDetail.tsx`, `SK/SkillDetail.test.tsx` (New), `client/src/app/skills/constants.ts`, `client/src/app/skills/_components/SkillDetailPane/SkillDetailPane.test.tsx` | Modify | route-local | AC-36…38 |
| client | nine test files with an `EvalRun` factory (listed in stage 3) | Modify (fixture only) | tests | NFR-8 |

## 3. Constraints in play
- depcruise stays green: `no-routes-to-drizzle`, `drizzle-only-in-repositories`, `no-service-to-container`, `no-cross-module-internals`. `EvalService` keeps `EvalDeps` only. The skill data arrives through the consumer-side port `EvalSkillsReader` (`EV/types.ts:187`), which `SkillsRepository` satisfies structurally, so `server/src/platform/container.ts` does not change.
- Module conventions: refusals are `AppError(code, message, 400)`; no `throw new Error(` in `EV/`; the repository returns no row type; `EV/scoring.ts` keeps zero imports; both paid routes carry `EVAL_RUN_RATE_LIMIT`.
- NG-9: `reviewer-core/` is untouched, and `buildCaseReviewInput`, `executeCase` and `scoring.ts` keep their bodies. A skill run differs from an agent run only in the `skills` array handed to the runner.
- NFR-10: no `expect` line of an existing server suite changes. A typed fixture may gain `skillId` / `skill_id` fields. An existing assertion that would have to change is reported, not edited.
- Both contract copies change in stage 3 only, with `diff -u` in Done-when.
- One migration, generated. Implementers cannot Edit/Write under `server/src/db/migrations/**` (`.claude/agents/scripts/guard-lib.sh:97`) and cannot apply migrations (`:55-58`). Applying it to the dev DB is stage 2, the calling session's.
- New server tests are named `server/test/eval-skill-*.it.test.ts`, so `verify:l06` (`vitest run src/modules/eval/ test/eval-`) and the tsc glob pick them up.
- `import type` only from `@devdigest/shared` in `client/`. Every message key of the feature is added in stage 4; later briefs report a missing key and never add one.
- Files are moved with plain `mv`. Implementers never write lockfiles, `server/package.json`, `.env*`, `.claude/settings*.json`, or anything outside the repository.
- Existing component props keep working: each shared component gains a second variant of a props union (`agentId` or `skill`), so no agent call site changes.

## 4. Stages

### Stage 1 — Storage: skill columns, the one-running-run rule per owner, agent reads without skill runs (server)
Track: shared · After: —
Files: `server/src/db/schema/eval.ts`, `server/src/db/migrations/0019_skill_evals.sql` (New, generated), `server/src/db/migrations/meta/0019_snapshot.json` (New, generated), `server/src/db/migrations/meta/_journal.json` (generated), `EV/types.ts`, `EV/repository.ts`, `EV/service.ts` (one call site), `server/test/eval-helpers.test.ts` (fixture only), `server/test/helpers/eval.ts`, `server/test/eval-skill-store.it.test.ts` (New)
Read first: `server/src/db/schema/eval.ts:77-117`; `server/src/db/schema/skills.ts:1-22`; `EV/repository.ts:33-56,135-166,284-466`; `EV/types.ts:73-110,138-169`; `EV/service.ts:266-279`; `server/src/db/migrations/0017_eval_pipeline.sql` and the tail of `meta/_journal.json` — what a generated file looks like; `server/drizzle.config.ts`; `server/test/eval-runs.it.test.ts:1-190,426-441` — the app harness and the reaper test; `server/test/eval-dashboard-rows.it.test.ts:60-165` — rows inserted directly; `server/test/helpers/eval.ts`; `server/test/eval-helpers.test.ts:120-145` — the `StoredRun` factory.
Steps:
1. `schema/eval.ts`, table `evalRuns`:
   - import `skills` from `./skills`;
   - add `skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'cascade' })` and `skillVersion: integer('skill_version')`, both nullable, no default;
   - replace `oneRunning` with two partial unique indexes:
     - `oneRunningAgent: uniqueIndex('eval_runs_one_running_agent_idx').on(t.agentId).where(sql\`status = 'running' and skill_id is null\`)`
     - `oneRunningSkill: uniqueIndex('eval_runs_one_running_skill_idx').on(t.skillId).where(sql\`status = 'running' and skill_id is not null\`)`
   - add `skillRanIdx: index('eval_runs_skill_ran_idx').on(t.skillId, t.ranAt)`.
   - No other column or table changes (NFR-9).
2. Generate: `cd server && ./node_modules/.bin/drizzle-kit generate --name skill_evals`.
   - Expected `0019_skill_evals.sql`: two `ADD COLUMN`, one `ADD CONSTRAINT … FOREIGN KEY ("skill_id") … ON DELETE cascade`, one `DROP INDEX "eval_runs_one_running_idx"`, three `CREATE … INDEX`. No `UPDATE`, no `DELETE`, no `DROP COLUMN`.
   - A second `drizzle-kit generate` must print `No schema changes, nothing to migrate`.
   - If the command asks a question, writes nothing or is refused by the guard: stop and report. Do not write the files by hand (§7).
3. `EV/types.ts`:
   - `StoredRunSummary` and `NewRun` gain `skillId: string | null` and `skillVersion: number | null`.
   - `EvalStore` gains `listCasesForSkill(workspaceId, skillId)`, `listDoneRunsForSkill(workspaceId, skillId, limit)`, `findRunningSkillRun(workspaceId, skillId)`, `listRunsForSkill(workspaceId, skillId, limit)`, with the return types of their agent twins.
4. `EV/repository.ts`:
   - `RUN_SUMMARY_COLUMNS` and `summaryFromRow` carry the two columns; `insertRunningRun` writes them.
   - Add `isNull(t.evalRuns.skillId)` to the seven agent-side reads: `listDoneRunsForAgent`, `findRunningRun`, `listRunsForAgent`, `latestDoneRunPerAgent`, `recentDoneRuns`, `runningAgentIds`, `trendPerAgent` (AC-32).
   - The four skill twins filter by `workspace_id` and `skill_id`; `listCasesForSkill` filters `owner_kind = 'skill'` and orders as `listCasesForAgent` does.
   - `getRun`, `completeRun`, `failRunningRuns` stay as they are.
5. `EV/service.ts:267`: the `insertRunningRun` call passes `skillId: null, skillVersion: null`. Nothing else in the service.
6. `server/test/eval-helpers.test.ts`: the `StoredRun` factory gains the two null fields. `server/test/helpers/eval.ts`: add `insertEvalSkill(db, workspaceId, over?)` (a `skills` row plus its `skill_versions` row for version 1) and `insertSkillRun(db, { workspaceId, skillId, hostAgentId, status, … })`.
Skills: `drizzle-orm-patterns` → `references/schema-definition.md`, `references/migrations.md`; `postgresql-table-design` → `SKILL.md` § "Indexing", § "Safe Schema Evolution" (nullable columns without a default; an FK column gets its index); `onion-architecture` → `rules/drizzle-persistence.md` § "Row types do not cross the repository boundary", § "Migrations", `rules/testing.md` § "The suffix routes the CI lane".
Tests to add: `server/test/eval-skill-store.it.test.ts`
- NFR-9 / EC-25: runs and cases inserted in the pre-feature shape (no skill column named) read back through `GET /agents/:id/eval-runs`, `GET /agents/:id/eval-cases` and `GET /eval-runs/:id` with every earlier value, and `skillId` null in the repository.
- AC-32: a host agent with one own completed run, 20 newer completed hosted skill runs and one hosted `running` skill run. The agent's run list holds the own run alone; its case's `last_result` comes from the own run; in `GET /eval/dashboard`, `latest_run` is the own run, `run_in_progress` is false, `trend` has one entry and `recent_runs` holds the own run alone.
- AC-22: a `running` skill run present before `buildApp` reads `failed` / `interrupted` after.
- The rule at the store (DR-3): `insertRunningRun` for skill S on host A returns a row while A's own run is `running`; a second for S returns `null`; one for skill S2 on A returns a row; a second own run of A returns `null`.
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval-` is green and the report says the `.it` suites ran, not skipped; it lists the test totals as the baseline for stage 15; the second `drizzle-kit generate` printed "No schema changes".
Can break: every `server/test/eval-*.it.test.ts` (they migrate their own DB with 0019) — hence the `eval-` filter.

### Stage 2 — The migration on the dev DB (CALLING SESSION)
Track: calling session · After: 1 · may run while implementers work
Files: none in the repository; the database `devdigest` in `devdigest-postgres`
Read first: `INSIGHTS.md:40-47` — the recipe; `specs/2026-10-12-eval-pipeline-plan.md:803-830` — the previous run of it.
Steps:
1. Do not restart `./scripts/dev.sh` before step 2: it applies pending migrations on start, which would skip the backup.
2. Backup: `docker exec devdigest-postgres pg_dump -U devdigest -Fc devdigest > /tmp/devdigest-pre-skill-evals-<stamp>.dump`.
3. Before-picture:
   - per-table counts of `eval_cases`, `eval_runs`, `agents`, `skills`, `skill_versions`, `agent_skills`, `reviews`, `findings`, `agent_runs`, `run_traces`;
   - sorted `psql -At` exports of `eval_cases` (`select *`) and of `eval_runs` with its 23 pre-feature columns named explicitly, so the new columns do not change a line.
4. Dry run on a copy in the same container:
   - `createdb devdigest_seedcheck`, `pg_restore --no-owner`, then `cd server && DATABASE_URL=postgres://devdigest:devdigest@localhost:5432/devdigest_seedcheck pnpm db:migrate`.
   - Take the exports again: `comm -23` prints zero lines for both tables and every count is equal.
   - `select count(*) from eval_runs where skill_id is not null or skill_version is not null` is 0.
   - `\d eval_runs` shows the two columns, the three new indexes, and no `eval_runs_one_running_idx`.
   - `dropdb devdigest_seedcheck`.
5. Repeat the migration on `devdigest`, then the same exports and diff. Keep the dump until the user has looked.
Skills: none routed (no repository file).
Tests to add: none.
Done when: both diffs are empty and the counts match (NFR-9, manual half).
Note: between stage 1 and this stage the dev API's eval routes answer 500 (`column "skill_id" does not exist`). Run this stage as soon as B1 reports. The old code works on the migrated schema, so the step is safe whether or not the feature lands.

### Stage 3 — Contracts, both copies; the run record's two fields
Track: shared · After: 1
Files: `server/src/vendor/shared/contracts/eval.ts`, `client/src/vendor/shared/contracts/eval.ts`, `EV/helpers.ts`, `server/test/eval-contracts.test.ts`, and the `run()` / `makeRun()` factory of nine client test files:
- `ER/RunHistory/RunHistory.test.tsx`
- `ER/RunControl/RunControl.test.tsx`
- `ER/MetricTiles/MetricTiles.test.tsx`
- `ER/MetricTrend/MetricTrend.test.tsx`
- `client/src/lib/hooks/evals.test.tsx`
- `client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx`
- `client/src/app/eval/[agentId]/_components/AgentEvalView/helpers.test.ts`
- `client/src/app/eval/_components/EvalDashboard/EvalDashboard.test.tsx`
- `ET/EvalsTab.test.tsx`

Read first: `server/src/vendor/shared/contracts/eval.ts:120-222`; `EV/helpers.ts:275-303`; `server/test/eval-contracts.test.ts:54-95,212-240`; the factory at the top of each client file (`:11-45`).
Steps:
1. The same text in both copies:
   - `EvalRun` gains `skill_id: z.string().nullable()` and `skill_version: z.number().int().nullable()`, after `agent_version`.
   - `EvalSkillRunStartInput = z.object({ host_agent_id: z.string().uuid() })`.
   - `EvalSkillCaseTryInput = EvalCaseTryInput.extend({ host_agent_id: z.string().uuid() })`.
   - `EvalSkillCompareSide = z.object({ run_id: z.string(), skill_version: z.number().int(), skill_body: z.string(), agent_id: z.string(), agent_version: z.number().int(), provider: z.string(), model: z.string(), started_at: z.string(), recall: Metric, precision: Metric, citation_accuracy: Metric, cost_usd: z.number().nullable(), cases_total: z.number().int(), cases_passed: z.number().int() })`.
   - `EvalSkillRunCompare = z.object({ base: EvalSkillCompareSide, head: EvalSkillCompareSide, cases_only_in_base: z.array(z.string()), cases_only_in_head: z.array(z.string()), cases_edited: z.array(z.string()) })`.
   - Each gets a same-named `export type`. `POST /skills/:id/eval-cases` reuses `EvalCaseCreateInput`.
2. `EV/helpers.ts` `toRunDto`: `skill_id: run.skillId`, `skill_version: run.skillVersion`. This is the one mapper, so the run lists, the dashboard, the 202 and `GET /eval-runs/:id` all carry the fields (AC-24).
3. The nine client factories gain `skill_id: null, skill_version: null`. The run fixture of `eval-contracts.test.ts` gains the same. No `expect` line changes.
Skills: `zod` → `SKILL.md`; `onion-architecture` → `rules/zod-contracts.md` § "Both copies must change", § "Naming and casing"; `react-testing-library` → `SKILL.md` (fixtures only).
Tests to add: `server/test/eval-contracts.test.ts` — a run with a skill id and version parses, and one with both null; each new schema parses one valid value; `EvalSkillRunStartInput` and `EvalSkillCaseTryInput` refuse a non-uuid `host_agent_id`; the byte-identity test stays (NFR-8).
Done when: `diff -u server/src/vendor/shared/contracts/eval.ts client/src/vendor/shared/contracts/eval.ts` prints nothing; `.claude/agents/scripts/check-code.sh server` and `.claude/agents/scripts/check-code.sh client` are green, both unfiltered (nothing runs in parallel yet).

### Stage 4 — Every message key of the feature
Track: shared · After: 3
Files: `client/messages/en/eval.json`, `client/messages/en/skills.json`
Read first: `client/messages/en/eval.json:59-63,125-161,186-252`; `client/messages/en/skills.json:26-44`.
Steps (no key is removed or renamed; texts are worded from the criterion):
1. `skills.json`:
   - `detail.tabs.evals`: "Evals" (AC-37).
   - `detail.deleteConfirm` gains the sentence that the skill's eval cases and eval runs are deleted with it (AC-36).
2. `eval.json`, new group `skillEvals`:
   - `hostLabel` ("Host agent"), `hostOption` ("{name} · {model}") — AC-45.
   - `noHostHint` — a host agent is needed; create an agent first (AC-47, AC-64).
   - `disabledNotice` — an eval uses the skill's saved body although the skill is disabled (AC-48).
   - `emptyTitle` "No eval cases yet", `emptyBody` "Add a case to test this skill against a known diff and expected findings." — AC-40, verbatim.
   - `metricsSubtitle` — the skill wording of `evalsTab.metricsSubtitle`.
   - `runAllTitle`: "{count, plural, one {# model call} other {# model calls}} through {agent}" (AC-49).
   - `history.host` ("Host agent"), `history.hostValue` ("{name} v{version}") — AC-65.
   - `compare.title` ("Compare runs · skill v{base} → v{head}"), `compare.bodyHeading`, `compare.bodyUnchanged` (both runs used the same skill body — AC-68), `compare.hostAgent`, `compare.hostVersion` (AC-69), `compare.onlyInOlder`, `compare.onlyInNewer` (both "{names}" — AC-72).
3. `eval.json`, under `caseEditor`: `skillSubtitle` ("{skill} · host agent {agent} · …") and `skillSubtitleNoHost` ("{skill} · …") — AC-59.
4. Reused as they are: `caseEditor.newCase`, `runs.runAll`, `runs.runningLabel`, `runs.status.*`, `runs.history.*`, `runs.compare.{older,newer,difference,cost,added,removed,provider,model,configHeading,edited,differentCases,loadError,close}`, `evalsTab.{casesHeading,passing,count,neverRun,passed,failed,errored,expectedGot,expectation.*,runCase,runCaseTitle,trial,editCase,deleteCase,deleteTitle,deleteBody,delete,loadingCases,loadError,runsLoadError,retry,neverRunSet,scoringNote,metricsTitle}`, `dashboard.loading`.
Skills: none routed for a JSON catalog (conventions lane; NFR-11).
Tests to add: none.
Done when: `.claude/agents/scripts/check-code.sh client` is green, unfiltered; both files parse.
Can break: a suite asserting the old `detail.deleteConfirm` text. None found by `grep -rn "lose it immediately" client/src`.

### Stage 5 — Skill cases: list, create, and the owner of an update (server)
Track: server · After: 3
Files: `EV/types.ts`, `EV/service.ts`, `EV/routes.ts`, `server/test/helpers/eval.ts`, `server/test/eval-skill-cases.it.test.ts` (New)
Read first: `EV/service.ts:133-237,469-492,570-578`; `EV/routes.ts:54-87`; `EV/types.ts:181-189`; `server/src/modules/skills/repository.ts:68-76,236-254` — `getById` and `getVersion`, the methods the port names; `server/test/eval-case-update.it.test.ts:60-135,211-300` — fixtures and the direct run insert; `server/test/eval-case-create.it.test.ts:1-110`; `server/test/eval-dashboard-rows.it.test.ts:140-165` — how repository calls are counted.
Steps:
1. `EV/types.ts`:
   - `EvalSkillRecord { id: string; name: string; type: string; source: string; body: string; version: number }`.
   - `EvalSkillsReader` gains `getById(workspaceId: string, id: string): Promise<EvalSkillRecord | undefined>` and `getVersion(skillId: string, version: number): Promise<{ body: string } | undefined>`. `SkillsRepository` satisfies both as it is.
2. `EV/service.ts`:
   - private `skillOr404(workspaceId, skillId)` → `NotFoundError('Skill not found')`.
   - Extract the body of `createCase` after the agent lookup into private `insertManualCase(workspaceId, owner: { kind: 'agent' | 'skill'; id: string }, input: EvalCaseCreateInput)`. `createCase` calls it with the agent and stores the same values as today.
   - `createSkillCase(workspaceId, skillId, input)` = `skillOr404`, then `insertManualCase` with `kind: 'skill'` (AC-2: `sourceFindingId`, `prNumber`, `prAuthor` null).
   - `listSkillCases(workspaceId, skillId)` = `skillOr404`, then `listCasesForSkill` and `listDoneRunsForSkill` in one `Promise.all`, mapped with `lastResultFor` (AC-1; two statements whatever the number of cases — NFR-14).
   - `updateCase`: pick the running-run lookup and the done-run list by `stored.ownerKind` (`findRunningSkillRun` / `listDoneRunsForSkill` for a skill case) — AC-4, AC-5.
   - `runInProgress(runId, ownerKind = 'agent')`: the skill message reads "An eval run of this skill is already in progress"; the agent message is unchanged.
   - `deleteCase` is unchanged (AC-6).
3. `EV/routes.ts`:
   - `GET /skills/:id/eval-cases` — `{ params: IdParams, response: { 200: z.array(EvalCase) } }`.
   - `POST /skills/:id/eval-cases` — `{ params: IdParams, body: EvalCaseCreateInput, response: { 201: EvalCase } }`.
Skills: `onion-architecture` → `rules/ports-and-di.md` § "A port is defined by the consumer", `rules/fastify-transport.md` § "A route does exactly four things", § "Validation is declarative", `rules/errors.md` § "Three rules", `rules/testing.md`; `fastify-best-practices` → `rules/testing.md`, `rules/schemas.md`; `zod` → `SKILL.md`; `security` → `checklists.md` § "New API Endpoint Checklist" (workspace scoping, params and body schemas — UI-4, UI-5).
Tests to add: `server/test/eval-skill-cases.it.test.ts`
- AC-1: two cases, one covered by a completed skill run inserted with `insertSkillRun`, one never run.
- AC-2: the new row has `owner_kind` `skill` and the skill's id.
- AC-3: a blank `name` (422), prose as the diff, lines outside every hunk — each with an unchanged row count.
- AC-4: a rename keeps `revision` 1 and the last result; a changed `end_line` gives `revision` 2 and `last_result` null.
- AC-5: an update while a stored skill run is `running`. The reverse edge: an agent run of the host `running` does not refuse the skill case's update.
- AC-6: the case is gone and the completed skill run still holds its outcome.
- AC-7: a skill of a second workspace on both routes; unchanged counts.
- AC-8: an agent and a skill with one case each; each list holds its own.
- NFR-6: a non-uuid id answers 422; a body of 1,100,000 bytes stores nothing; a `file` of `'; drop table eval_cases; --` is read back as that text.
- NFR-14: the same number of repository calls for 1 case and for 5.
- NFR-1: the mock provider, git and GitHub clients record no call.
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval-` is green, with the `.it` suites run.
Can break: `eval-case-create.it`, `eval-cases.it`, `eval-case-update.it`, `eval-case-draft.it` (the `createCase` extraction and the `updateCase` branch) — all inside the `eval-` filter.

### Stage 6 — A run of the skill's set and a try of one case (server)
Track: server · After: 5
Files: `EV/constants.ts`, `EV/service.ts`, `EV/routes.ts`, `EV/runner.ts`, `server/test/helpers/eval.ts`, `server/test/eval-helpers.test.ts`, `server/test/eval-skill-runs.it.test.ts` (New), `server/test/eval-skill-try.it.test.ts` (New)
Read first: `EV/service.ts:243-312,401-462`; `EV/runner.ts:56-78,130-196`; `EV/helpers.ts:186-217`; `server/src/domain/reviews/prompt-parts.ts:27-52` — `PromptSkill` and the block label; `EV/routes.ts:89-119`; `server/test/eval-runs.it.test.ts:59-190,324-345,384-441,467-520,569-624` — the scripted LLM, the provider-less app, the second start, 21 runs, the rate-limit and log assertions; `server/test/eval-case-try.it.test.ts:100-175,211-300,325-411`; `server/test/eval-helpers.test.ts:140-235` — `assemble()` over the prompt; `server/test/reviews-skills.it.test.ts` — `runAndTrace` for the NFR-5 review check.
Steps:
1. `EV/constants.ts`: `EVAL_ERROR.hostAgentMissing = 'eval_host_agent_missing'`.
2. `EV/service.ts`, private helpers (the agent paths call them and behave as today):
   - `providerOf(agent)` — the `try/catch` around `deps.llm` now written twice, with the same error.
   - `hostOrRefuse(workspaceId, hostAgentId)` → `AppError(hostAgentMissing, 'The host agent does not exist in this workspace', 400)`.
   - `promptSkillOf(skill: EvalSkillRecord): PromptSkill`.
   - `runTry(agent, skills, input, sessionId, logExtra)` — the `executeCase` call, the log line and the result mapping of `tryCase`. `tryCase` passes its `linkedEnabled` skills and `{}`.
3. `startSkillRun(workspaceId, skillId, hostAgentId): Promise<EvalRun>`, in this order:
   1. `skillOr404`.
   2. `hostOrRefuse` (AC-9).
   3. `listCasesForSkill`; empty → `eval_no_cases` with a skill message (AC-17).
   4. `findRunningSkillRun` → `runInProgress(id, 'skill')` (AC-18).
   5. `providerOf(host)` (AC-10).
   6. `insertRunningRun` with `agentId: host.id`, `agentVersion: host.version`, the host's `provider` and `model`, `skillId: skill.id`, `skillVersion: skill.version`, `skills: [skill.name]`, every case id. `null` → `findRunningSkillRun` again → `runInProgress`.
   7. Log `'eval run started'` with the agent run's keys plus `skillId` and `skillVersion`.
   8. `void executeEvalRun(deps, { run, agent: host, skills: [promptSkillOf(skill)], llm, cases })`.
   - The skill row is read once, in step 1, so every case gets that body (AC-25). Neither `enabled` flag is read (AC-11). `linkedEnabled` is not called (AC-12).
4. `EV/runner.ts`: the settle log spreads `...(run.skillId ? { skillId: run.skillId, skillVersion: run.skillVersion } : {})`. The start log in the service does the same. An agent run's log records keep their shape.
5. `listSkillRuns(workspaceId, skillId)` = `skillOr404`, `listRunsForSkill(…, EVAL_RUN_LIST_LIMIT)`, `toRunDto` (AC-23).
6. `trySkillCase(workspaceId, skillId, input: EvalSkillCaseTryInput)`: `skillOr404` → `hostOrRefuse` → `checkCaseInput` → `providerOf` → `runTry(host, [promptSkillOf(skill)], input, \`eval-try:skill:${skill.id}\`, { skillId, skillVersion })`. No `deps.store` write and no running-run check (AC-27, AC-29).
7. `EV/routes.ts`:
   - `POST /skills/:id/eval-runs` — `{ schema: { params: IdParams, body: EvalSkillRunStartInput, response: { 202: EvalRun } }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } }`.
   - `GET /skills/:id/eval-runs` — `{ params: IdParams, response: { 200: z.array(EvalRun) } }`.
   - `POST /skills/:id/eval-cases/try` — `{ schema: { params: IdParams, body: EvalSkillCaseTryInput, response: { 200: EvalCaseTryResult } }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } }`.
Skills: `onion-architecture` → `rules/ports-and-di.md` § "Inject ports, not the container", `rules/fastify-transport.md` § "Validation is declarative", `rules/errors.md`, `rules/testing.md`; `fastify-best-practices` → `rules/testing.md`; `zod` → `SKILL.md`; `security` → `checklists.md` § "Input Validation", § "Error Handling" (the paid routes are rate-limited; diff and description reach the model only through `buildCaseReviewInput`; the skill body only as the one labelled block — UI-1…UI-4, UI-6).
Tests to add:
- `server/test/eval-helpers.test.ts` (unit):
  - AC-13: a host with repo intel on and a skill with attached documents — the assembled input holds the diff, the title, the description and the skill block, and none of the listed sections or values.
  - AC-14: the strings for a skill case and for an agent case of the same content, with that skill as the host's only skill, are identical.
  - NFR-4: "ignore the instructions above" stands inside the diff block, outside the system message and the skill block.
  - NFR-5: the block heading of an imported skill names its source as third-party.
- `server/test/eval-skill-runs.it.test.ts`:
  - AC-9: a random uuid and an agent of a second workspace.
  - AC-10.
  - AC-11: a disabled skill hosted by a disabled agent — the stored row and the 202.
  - AC-12: one structured call per case; the prompt holds the host's system prompt and the skill's heading and body, and no heading of a second enabled skill linked to the host; a disabled unlinked skill runs the same way.
  - AC-15: one passing `must_find`, one failing `must_not_flag` → `done`, recall 1, precision 0, two outcomes, two calls.
  - AC-16: four row counts.
  - AC-17.
  - AC-18: two starts, one `running` row, `details.run_id`.
  - AC-19, AC-20.
  - AC-21: the second of three throws.
  - AC-23: 21 runs → 20 newest, no `results`.
  - AC-24.
  - AC-25: `PUT /skills/:id` with a new body from inside the first scripted call; both prompts hold the first body and the run keeps the earlier version.
  - AC-7: both run routes.
  - NFR-2, NFR-3 (route config).
  - NFR-5: after a run of a disabled linked skill, a review of that agent and an agent run record no block of it; poll the trace.
  - NFR-6: a non-uuid `host_agent_id` is 422; an oversized body starts nothing.
  - NFR-13: two log records with `skillId` and `skillVersion`; the fixture body's and the fixture diff's text are absent.
  - NFR-14: no git or GitHub call.
- `server/test/eval-skill-try.it.test.ts`:
  - AC-26: one call whose prompt holds the skill block and the body's diff; an overlapping grounded finding gives `pass` for `must_find`.
  - AC-27: counts and both list responses over a pass, a fail and an error.
  - AC-28: mock calls empty.
  - AC-29.
  - AC-9, AC-10 and AC-7 on the try route.
  - NFR-3, NFR-13 (one record).
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval- reviews-skills` is green with the `.it` suites run; `grep -rn "throw new Error(" server/src/modules/eval` prints nothing; `grep -c "^import" server/src/modules/eval/scoring.ts` prints 0.
Can break: `eval-runs.it` (`providerOf`, the conditional log keys — the NFR-12 test at `:586`), `eval-case-try.it` (`runTry`, the NFR-13 log test at `:341`), `eval-promote.it`, `reviews-skills.it`.

### Stage 7 — Comparing two skill runs; deleting a skill and a host agent (server)
Track: server · After: 6
Files: `EV/service.ts`, `EV/routes.ts`, `server/src/modules/skills/repository.ts`, `server/test/eval-skill-compare.it.test.ts` (New), `server/test/eval-skill-delete.it.test.ts` (New)
Read first: `EV/service.ts:318-352,537-568`; `EV/helpers.ts:337-377` — `compareSides`; `EV/routes.ts:121-134`; `server/src/modules/skills/repository.ts:228-254`; `server/src/modules/agents/repository.ts:73-93` — the transaction this stage mirrors; `server/test/eval-compare.it.test.ts:100-300`; `server/test/skills.it.test.ts:220-250` — the existing delete test.
Steps:
1. `compareRuns` (agent): the refusal condition gains `run.skillId !== null` (AC-33).
2. `compareSkillRuns(workspaceId, skillId, baseId, headId): Promise<EvalSkillRunCompare>`:
   - `skillOr404`; fetch both runs.
   - Refuse with `notComparable()` unless each run exists, has `skillId === skillId`, `status === 'done'` and a non-null `skillVersion` (AC-31).
   - Sort as `compareRuns` does: older first, the id as tie-break.
   - Each body comes from `deps.skills.getVersion(skillId, run.skillVersion)`; a missing snapshot → `notComparable()` (EC-21).
   - `compareSides(older, newer)`; map each side with a private `skillCompareSide(run, body, score)` to the fields of `EvalSkillCompareSide`. `agent_id` and `agent_version` are the run's stored host values.
3. `EV/routes.ts`: `GET /skills/:id/eval-runs/compare` — the agent route's querystring schema, `response: { 200: EvalSkillRunCompare }`.
4. `SkillsRepository.deleteById`: one `db.transaction` — delete `eval_cases` where `workspace_id`, `owner_kind = 'skill'`, `owner_id = id`; then delete the skill `returning`; return `rows.length > 0`. The skill's runs go through the stage 1 foreign key (AC-34, MI-15). `SkillsService.delete` and the route are unchanged.
Skills: `onion-architecture` → `rules/drizzle-persistence.md` § "Transactions are a use-case decision" (the accepted exception of `server/INSIGHTS.md` — §8), `rules/layers.md` § "Cross-module rules", `rules/fastify-transport.md`, `rules/testing.md`; `drizzle-orm-patterns` → `references/transactions.md`; `fastify-best-practices` → `rules/testing.md`; `zod` → `SKILL.md`; `security` → `checklists.md` § "Input Validation" (query schema; a run id of another skill or workspace is refused).
Tests to add:
- `server/test/eval-skill-compare.it.test.ts`:
  - AC-30: runs at skill versions 1 and 2 return both bodies and the host fields; swapped ids give the same body; a case edited between them is in `cases_edited` and left out of the values.
  - AC-31: a `running` skill run, a run of a second skill, an agent run of the host, and a version whose snapshot row was removed in the test.
  - AC-33: an agent run compared with a hosted skill run on the agent route.
  - AC-7: the compare route.
  - NFR-1: no provider call.
- `server/test/eval-skill-delete.it.test.ts`:
  - AC-34: a skill with two cases and one run beside an agent with one case and one run; after `DELETE /skills/:id` the agent's rows are identical and the skill's are gone.
  - EC-32: a `running` run of the deleted skill is gone, and a later `completeRun` for its id stores nothing.
  - AC-35: after `DELETE /agents/:id` of the host, the skill reads one case with `last_result` null and an empty run list.
  - A skill of another workspace is not deleted.
Done when: `.claude/agents/scripts/check-code.sh --it server -- eval- skills.it agents` is green with the `.it` suites run.
Can break: `eval-compare.it` (the added refusal), `skills.it` ("deleting a skill removes it from the agents that linked it"), the agents delete suites.

### Stage 8 — Client data layer: an eval owner that is an agent or a skill
Track: client-data · After: 3
Files: `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/evals.test.tsx`, `ER/helpers.ts`, `ER/helpers.test.ts`, `ER/index.ts`
Read first: `client/src/lib/hooks/evals.ts`; `client/src/lib/hooks/evals.test.tsx:1-60,100-200`; `ER/helpers.ts:1-20`; `ER/index.ts`; `client/src/lib/api.ts:21-74`.
Steps:
1. `hooks/evals.ts`:
   - `export type EvalOwner = { kind: "agent"; id: string } | { kind: "skill"; id: string; hostAgentId: string | null }`.
   - The hooks take `string | EvalOwner` (a bare string is an agent id, so no call site changes), nullable where they are today. Internal `ownerOf(input)` and `ownerPath(owner)` (`/agents/<id>` or `/skills/<id>`).
   - `evalKeys.cases` / `.runs`: an agent keeps `["eval-cases", id]` / `["eval-runs", id]`; a skill uses `["eval-cases", "skill", id]` / `["eval-runs", "skill", id]`. `hostAgentId` is never part of a key.
   - `useEvalCases`, `useEvalRuns`, `useCreateManualEvalCase`, `useUpdateEvalCase`, `useDeleteEvalCase` use `ownerPath` and the owner's key. `PUT` and `DELETE` keep `/eval-cases/:id`.
   - `useEvalRuns`: the settle effect invalidates the owner's cases key and the run key (AC-52); the dashboard key only for an agent.
   - `useStartEvalRun(owner)`: a skill posts `{ host_agent_id: owner.hostAgentId }` (AC-50); an agent posts no body, as today.
   - `useTryEvalCase(owner)`: a skill adds `host_agent_id` to the body (AC-56, AC-62).
   - New `useSkillEvalCompare(skillId, base, head)` → `EvalSkillRunCompare`, key `["eval-compare", "skill", skillId, base, head]`, enabled only with all three.
2. `ER/helpers.ts`, exported from `ER/index.ts`:
   - `export interface SkillEvalTarget { id: string; name: string; host: { id: string; name: string } | null }`
   - `export function skillOwner(skill: SkillEvalTarget): EvalOwner`
   - `export const EVAL_NO_HOST_HINT_ID = "eval-no-host-hint"`
Skills: `frontend-ui-architecture` → `logic.md` § "The API layer", § "Hooks are the seam, not the home", `placement.md` § "Types"; `react-best-practices` → `SKILL.md`; `react-testing-library` → `SKILL.md`.
Tests to add:
- `client/src/lib/hooks/evals.test.tsx`, for a skill owner: each read hits `/skills/<id>/…`; create posts to `/skills/<id>/eval-cases`; start posts `{ host_agent_id }`; try posts the body plus `host_agent_id` and invalidates nothing; a run list that goes `running` → `done` is followed by one more read of the skill's cases and none of the dashboard; update and delete invalidate the skill's cases key. The existing agent tests stay as they are.
- `ER/helpers.test.ts` — `skillOwner` with and without a host.
Done when: `.claude/agents/scripts/check-code.sh client` is green, unfiltered. The server track runs in parallel in another package; no other client brief has started.
Can break: every suite that renders an eval component or mocks `@/lib/hooks/evals` (`AgentEditor.test.tsx:40`) — hence the unfiltered run.

### Stage 9 — The case list moves to the cross-route tier and takes a skill (client)
Track: client-rows · After: 4, 8
Files: `CL/{CaseList.tsx,CaseList.test.tsx,helpers.ts,styles.ts,index.ts}` (moved with `mv` from `ET/_components/CaseList/`), `ET/EvalsTab.tsx` (the import line only)
Read first: `ET/_components/CaseList/CaseList.tsx`; its `styles.ts`, `helpers.ts`, `index.ts`; `ET/_components/CaseList/CaseList.test.tsx:1-80` — the harness; `client/src/components/confirm-dialog/index.ts` — the flat cross-route folder shape; `ER/helpers.ts` — `SkillEvalTarget`.
Steps:
1. `mv` the five files into `CL/`. Fix the relative `messages/en/*.json` import in the moved test. `ET/EvalsTab.tsx` imports `CaseList` from `@/components/eval-case-list`.
   - The folder is its own, not inside `ER/`: `CE/` imports `ER/` and the list imports `CE/` (`TryResult`), so a home under `ER/` would close a cycle.
2. Props become a union: the shared ones plus `{ agentId: string; skill?: undefined } | { skill: SkillEvalTarget; agentId?: undefined }`. `const owner = skill ? skillOwner(skill) : agentId`, handed to `useDeleteEvalCase` and, per row, `useTryEvalCase`.
3. `CaseRow` with a skill that has no host: the run button is `disabled` and carries `aria-describedby={EVAL_NO_HOST_HINT_ID}` (AC-47). The parent renders the hint.
4. Nothing else changes: the row's result words, the three native buttons with the case's name, the trial line, the delete dialog (AC-42, AC-57, AC-58).
Skills: `frontend-ui-architecture` → `placement.md` § "The ladder" (a second route renders it), § "The component folder", `boundaries.md` § "Circular dependencies", `composition.md` § "Prop design"; `react-best-practices` → `SKILL.md`; `react-testing-library` → `SKILL.md`.
Tests to add: `CL/CaseList.test.tsx`, with a skill owner:
- AC-42: four rows, one per result state, each with three named buttons.
- AC-56: one `POST /skills/<id>/eval-cases/try` whose body equals the row's case plus the host id; no other write.
- AC-57: a pending request on one of two rows; a pass labelled as a trial beside "never run"; a mocked 400 on the row.
- AC-58: one `DELETE /eval-cases/<id>` and a list of one row less.
- AC-47: no host → the run buttons are disabled and described, edit and delete are enabled.
- NFR-7: a case name of `<img src=x onerror=alert(1)>` is visible text with no `img` element.
- The moved agent tests pass unchanged.
Done when: `.claude/agents/scripts/check-code.sh client -- CaseList.test EvalsTab.test AgentEditor.test` is green, with `Test Files N` compared against the suites meant; `grep -rn "_components/CaseList" client/src` prints nothing.
Can break: `ET/EvalsTab.test.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx`.

### Stage 10 — The case modal with a skill as owner (client)
Track: client-modal · After: 4, 8
Files: `CE/CaseEditorDialog.tsx`, `CE/CaseEditorDialog.test.tsx`, `CE/index.ts`
Read first: `CE/CaseEditorDialog.tsx:61-172,199-227`; `CE/CaseEditorDialog.test.tsx:1-110` — `renderDialog` and the fetch mock; `CE/helpers.ts:118-128,171-210`; `ER/helpers.ts` — `SkillEvalTarget`.
Steps:
1. `CaseEditorDialogProps` becomes a union over the owner: `{ agent: { id: string; name: string }; source?: …; skill?: undefined } | { skill: SkillEvalTarget; agent?: undefined; source?: undefined }`, with `evalCase`, `onClose`, `onSaved` shared.
2. `const owner = skill ? skillOwner(skill) : agent.id`, handed to `useCreateManualEvalCase`, `useUpdateEvalCase`, `useTryEvalCase`. `useSaveEvalCaseFromFinding` is unchanged and unreachable with a skill, so no request goes to an agent route (AC-61).
3. Subtitle: with a skill, `caseEditor.skillSubtitle` (`{ skill: skill.name, agent: skill.host.name }`) or `caseEditor.skillSubtitleNoHost`; with an agent as today (AC-59).
4. `const canRun = !skill || skill.host !== null`.
   - Run case is `disabled` when `!canRun`, with `aria-describedby` on a footer `<span id="eval-case-editor-no-host">` holding `skillEvals.noHostHint`.
   - `runCase` returns early when `!canRun`.
   - `afterSave` closes when `!runOnSave || !canRun` (AC-64).
5. Everything else — Cancel and discard, the result region, the stale mark, "Run after saving", the error line — is the code that exists, now on the owner's routes (AC-63).
Skills: `react-best-practices` → `SKILL.md` (derive `canRun` in render); `frontend-ui-architecture` → `composition.md` § "Prop design", `logic.md` § "The four kinds of state"; `react-testing-library` → `SKILL.md`; `security` → `SKILL.md` (API messages and names as text).
Tests to add: `CE/CaseEditorDialog.test.tsx`
- AC-59: the title, the skill's and the host's names, empty fields, an editable type.
- AC-60: stored values and "Last run failed".
- AC-61: `POST /skills/<id>/eval-cases` in new mode, `PUT /eval-cases/<id>` in edit mode, no path starting with `/agents/`.
- AC-62: one try request whose body holds an edit made after opening, plus the host id; no save request.
- AC-63: the suite's new-mode and edit-mode cases for Cancel, the result region, the stale mark, "Run after saving" and a failed save or try, run again with a skill owner (`describe.each` over the owner).
- AC-64: no host → Run case disabled and described; a save closes with no try request.
- NFR-1: opening and typing send no `POST`.
- NFR-7: a finding title of a try holding `<img …>`.
Done when: `.claude/agents/scripts/check-code.sh client -- CaseEditorDialog.test TryResult.test EvalCaseAction.test` is green, with the file count compared.
Can break: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/_components/EvalCaseAction/EvalCaseAction.test.tsx`, and the `FindingCard`, `FindingsPanel` and `DiffTab` suites that render it; `ET/EvalsTab.test.tsx`.

### Stage 11 — The compare view for two skill runs (client)
Track: client-runs · After: 4, 8
Files: `CD/{CompareRunsDialog.tsx,CompareRunsDialog.test.tsx,styles.ts}`, `CD/helpers.ts` (New), `CD/helpers.test.ts` (New)
Read first: `CD/CompareRunsDialog.tsx`; `CD/CompareRunsDialog.test.tsx:1-90` — harness and fixtures; `CD/constants.ts`; `client/src/lib/text-diff.ts` — `diffLines`, `collapseUnchanged`; `client/src/lib/hooks/agents.ts:23-28,102-122`.
Steps:
1. Props union: `{ agentId: string; skillId?: undefined } | { skillId: string; hostNames: ReadonlyMap<string, string>; agentId?: undefined }`, plus `baseId`, `headId`, `onClose`.
2. All hooks stay unconditional: `useEvalCompare(agentId ?? null, …)`, `useSkillEvalCompare(skillId ?? null, …)`, `useAgent(agentId ?? null)`, `usePromoteAgentVersion(agentId ?? "")`. `data`, `isLoading`, `error` come from the query of the mode, so an agent comparison sends the requests it sends today.
3. `CD/helpers.ts`, pure: `compareView(input)` returns what the body renders from either response — `baseVersion`, `headVersion`, `baseText`, `headText`, `sameText`, `configRows: { id; from; to }[]`.
   - Agent: the versions are `agent_version`, the texts the system prompts, `sameText` is prompt equality, and the rows are provider, model, skills as today.
   - Skill: the versions are `skill_version`, the texts the skill bodies, `sameText` is `base.skill_version === head.skill_version` (AC-68), and the rows are host agent (name from `hostNames`, the id when absent), host agent version, provider, model — only those that differ (AC-69).
4. Rendering in skill mode:
   - title `skillEvals.compare.title` (AC-67);
   - no Promote block — guard the footer block with the mode, not only with `agent` (AC-70);
   - the left-out notice uses `skillEvals.compare.onlyInOlder` / `onlyInNewer` and the existing `runs.compare.edited` (AC-72);
   - the text section uses `skillEvals.compare.bodyHeading`, and `bodyUnchanged` when `sameText`;
   - the diff keeps the sign and the hidden `runs.compare.added` / `removed` labels beside colour (AC-67);
   - the error line is the existing alert (AC-71).
5. Agent mode renders what it renders today.
Skills: `react-best-practices` → `SKILL.md`; `frontend-ui-architecture` → `logic.md` § "Domain models and mapping", `composition.md` § "Prop design"; `react-testing-library` → `SKILL.md`; `security` → `SKILL.md` (two bodies and agent names as text — UI-3).
Tests to add:
- `CD/CompareRunsDialog.test.tsx`:
  - AC-67: versions 3 and 4 with one line added — the title, four cards with older, newer and difference, the added line labelled.
  - AC-68: two runs at version 2.
  - AC-69: different hosts on different models, listed above the body section.
  - AC-70: no button named "Promote".
  - AC-71: a mocked 400 `eval_runs_not_comparable`.
  - AC-72: one case in each of the three lists.
  - NFR-7: a body of `<img …>` as text.
  - NFR-12: Escape closes and focus returns to the opener.
  - A skill comparison sends no request to `/agents/`.
- `CD/helpers.test.ts` — `compareView` for both kinds.
Done when: `.claude/agents/scripts/check-code.sh client -- CompareRunsDialog.test RunHistory.test AgentEvalView.test` is green, with the file count compared.
Can break: `ER/RunHistory/RunHistory.test.tsx`, `client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx`, `ET/EvalsTab.test.tsx`. The promote tests are the ones a changed footer guard breaks.

### Stage 12 — The run control and the run history take a skill (client)
Track: client-runs · After: 11
Files: `ER/RunControl/{RunControl.tsx,RunControl.test.tsx}`, `ER/RunHistory/{RunHistory.tsx,RunHistory.test.tsx,styles.ts}`
Read first: `ER/RunControl/RunControl.tsx`; `ER/RunControl/RunControl.test.tsx:1-70`; `ER/RunHistory/RunHistory.tsx`; `ER/RunHistory/RunHistory.test.tsx:1-110`; `ER/RunHistory/styles.ts`.
Steps:
1. `RunControl` props union: `{ agentId: string; skill?: undefined } | { skill: SkillEvalTarget; agentId?: undefined }`, plus `caseCount` and `variant`. `owner` goes to `useEvalRuns` and `useStartEvalRun`.
   - With a skill and a host: `title={t("skillEvals.runAllTitle", { count: caseCount, agent: skill.host.name })}` (AC-49); the click is `start.mutate()` (AC-50).
   - With a skill and no host: `disabled`, with `aria-describedby={EVAL_NO_HOST_HINT_ID}` (AC-47).
   - Running, the refusal alert and the live region are the existing code (AC-51, AC-53).
2. `RunHistory` props union: `{ agentId: string } | { skill: SkillEvalTarget; hostNames: ReadonlyMap<string, string> }`.
   - With a skill: the version cell shows `runs.history.versionValue` of `run.skill_version`; one added column `skillEvals.history.host` after it shows `skillEvals.history.hostValue` (`runs.noValue` when the name is unknown) — AC-65.
   - It renders `<CompareRunsDialog skillId={skill.id} hostNames={hostNames} … />`.
   - The selection, the hint and the Compare control are unchanged (AC-66).
3. The table keeps its card; the added column must not widen the pane (`minWidth: 0`, wrapping in the name cell).
Skills: `react-best-practices` → `SKILL.md`; `frontend-ui-architecture` → `composition.md` § "Prop design"; `react-testing-library` → `SKILL.md`.
Tests to add:
- `ER/RunControl/RunControl.test.tsx`:
  - AC-49: three cases and the host "Security Reviewer".
  - AC-50: one `POST /skills/<id>/eval-runs` whose body holds the host id.
  - AC-51: a 202 disables the control; a second click sends nothing; a second read after 3 seconds of fake time.
  - AC-53: a mocked 400 `eval_provider_unavailable`, a mocked 400 `eval_host_agent_missing` and a mocked 429 — the message in an alert, the control enabled.
  - AC-47: no host.
  - NFR-12: the description of the disabled control.
- `ER/RunHistory/RunHistory.test.tsx`:
  - AC-65: two completed rows in order and one failed row with its error, `v2`, "Security Reviewer v3".
  - AC-66: one completed run leaves Compare disabled with its hint; two selected rows enable it and open the skill comparison.
Done when: `.claude/agents/scripts/check-code.sh client -- RunControl.test RunHistory.test AgentEvalView.test EvalsTab.test AgentEditor.test` is green, with the file count compared.
Can break: `AgentEvalView.test.tsx`, `ET/EvalsTab.test.tsx`, `AgentEditor.test.tsx`.

### Stage 13 — The Evals tab of the Skill Editor (client)
Track: client-tab · After: 9, 10, 12
Files: `ST/EvalsTab.tsx`, `ST/EvalsTab.test.tsx`, `ST/helpers.ts`, `ST/helpers.test.ts`, `ST/styles.ts`, `ST/index.ts` (all New)
Read first: `ET/EvalsTab.tsx` and `ET/styles.ts` — the layout and states to mirror; `ET/EvalsTab.test.tsx:1-140` — the fetch-mock harness; `SK/_components/StatsTab/StatsTab.tsx` — `useSkillAgents`; `client/src/lib/hooks/skills.ts:16-22,109-116`; `client/src/lib/hooks/agents.ts:16-21`; `client/src/app/skills/_components/SkillDetailPane/SkillDetailPane.tsx:49-60` — `EmptyState`; `client/src/vendor/ui/kit/SelectInput.tsx` — a real `<select>`.
Steps:
1. `ST/helpers.ts`, pure:
   - `orderHosts(agents: Agent[], linkedIds: readonly string[]): Agent[]` — the linked agents in the order of `linkedIds`, then the rest in list order (AC-45).
   - `defaultHostId(runs: readonly EvalRun[] | undefined, hosts: readonly Agent[], linkedIds: readonly string[]): string | null` — the newest run's `agent_id` when it is in `hosts`, else the first linked, else the first, else null (AC-46).
2. `EvalsTab({ skill }: { skill: Skill })`:
   - Reads: `useEvalCases(owner)`, `useEvalRuns(owner)`, `useAgents()`, `useSkillAgents(skill.id)` — four `GET`s, no write (AC-39).
   - State: `picked: string | null` and the editor state of `ET/EvalsTab.tsx`. The host is derived in render: `hosts.find((a) => a.id === picked) ?? hosts.find((a) => a.id === defaultHostId(…)) ?? null`.
   - `const target: SkillEvalTarget = { id: skill.id, name: skill.name, host: host ? { id: host.id, name: host.name } : null }`; `hostNames` is a `Map` of the agents list.
3. Layout, top to bottom, in a `minmax(0, 1fr)` stack:
   - The host selector: a `<label>` with the visible text `skillEvals.hostLabel` around `SelectInput`, options `skillEvals.hostOption` (AC-45, NFR-12). With no agent: `<span id={EVAL_NO_HOST_HINT_ID}>` with `skillEvals.noHostHint` (AC-47).
   - `skillEvals.disabledNotice` when `!skill.enabled` (AC-48).
   - The metrics section: `SectionLabel` with `evalsTab.metricsTitle` and `skillEvals.metricsSubtitle`; loading, failure with retry, or `MetricTiles latest previous` — the three branches of `ET/EvalsTab.tsx:42-59` (AC-43, AC-44, AC-54). Then `evalsTab.scoringNote`, and `evalsTab.neverRunSet` for cases with no completed run (AC-55). No `MetricTrend` and no dashboard link (NG-4, NG-3).
   - The cases part: loading text; failure with retry; for an empty list `EmptyState` with `skillEvals.emptyTitle`, `skillEvals.emptyBody`, and the cta `caseEditor.newCase` opening the modal (AC-40); otherwise `<CaseList skill={target} cases listStamp control={<RunControl skill={target} caseCount variant="all" />} actions={New eval case button} onEdit />` (AC-41).
   - `<RunHistory skill={target} hostNames={hostNames} />`.
   - `<CaseEditorDialog key={editor.evalCase?.id ?? "new"} skill={target} evalCase onClose />` when the editor is open (AC-59, AC-60).
4. `ST/styles.ts`: the stack, the selector row and the notices; `overflowWrap: "anywhere"` on text that holds names.
Skills: `react-best-practices` → `SKILL.md` (the host is derived, not synced by an effect); `frontend-ui-architecture` → `placement.md` § "Sub-component ownership", § "The component folder", `logic.md` § "The four kinds of state", § "Hooks are the seam, not the home"; `react-testing-library` → `SKILL.md`; `security` → `SKILL.md` (no raw HTML).
Tests to add:
- `ST/EvalsTab.test.tsx`:
  - AC-39: four reads, no `POST`, `PUT` or `DELETE`; `staleTime` repeated in the test client.
  - AC-40.
  - AC-41: three cases with a pass, a fail and no result give "1 / 2 passing", with both controls.
  - AC-43: a pending cases request and a pending runs request.
  - AC-44: a 500 on each read; retry sends that read again.
  - AC-45: three agents, the second linked, is the first option.
  - AC-46: a newest run hosted by the third agent; no run and one linked agent; no run and none linked.
  - AC-47: an empty agent list — run controls disabled and described, New enabled.
  - AC-48.
  - AC-52: `running` → `done` is followed by one more cases read and new tiles.
  - AC-54: two completed runs; a null `recall` shows "—" and no change.
  - AC-55.
  - AC-59: the modal opens naming the skill and the selected host.
  - NFR-1: changing the selector sends no `POST`.
  - NFR-7: an agent name of `<img …>`.
  - NFR-11: rendered with the real message files.
  - NFR-12: the select is found by its label; the alert of a refused start.
- `ST/helpers.test.ts` — `orderHosts`, `defaultHostId`.
Done when: `.claude/agents/scripts/check-code.sh client -- EvalsTab.test helpers.test` is green. `EvalsTab.test` matches the agent's suite too — both must pass; compare the file count. `grep -rnE '>[A-Z][a-z]+ [a-z]' client/src/app/skills/_components/SkillDetail/_components/EvalsTab --include=*.tsx | grep -v test` shows no literal UI string.

### Stage 14 — The tab in the Skill Editor (client)
Track: client-tab · After: 13
Files: `client/src/app/skills/constants.ts`, `SK/SkillDetail.tsx`, `SK/SkillDetail.test.tsx` (New), `client/src/app/skills/_components/SkillDetailPane/SkillDetailPane.test.tsx`
Read first: `client/src/app/skills/constants.ts:1-25`; `SK/SkillDetail.tsx`; `client/src/app/skills/_components/SkillDetailPane/SkillDetailPane.test.tsx:1-150`; `client/src/app/skills/helpers.ts:40-48`; `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` — the icon the agent's Evals tab uses.
Steps:
1. `constants.ts`: insert `{ key: "evals", labelKey: "detail.tabs.evals", icon: <the agent editor's Evals icon> }` between `preview` and `stats`. Rewrite the comment above `SKILL_TABS` (`:11-15`): the tab exists and shows stored cases and stored runs; the usage metrics stay out (NG-8). `SKILL_TAB_KEYS` follows, so `?tab=evals` resolves (AC-38).
2. `SK/SkillDetail.tsx`: `{tab === "evals" && <EvalsTab key={skill.id} skill={skill} />}` between Preview and Stats; the header comment says six tabs.
Skills: `frontend-ui-architecture` → `placement.md` § "Constants", § "Sub-component ownership"; `react-best-practices` → `SKILL.md`; `react-testing-library` → `SKILL.md`.
Tests to add:
- `SK/SkillDetail.test.tsx`:
  - AC-37: the order of the six tab buttons, read from the parent of the Config button.
  - AC-36: the confirmation dialog states that the eval cases and eval runs are deleted; no `DELETE` is recorded before Confirm, one after.
- `SkillDetailPane.test.tsx`:
  - AC-38: the Evals heading renders for `?tab=evals`, and again after a remount.
Done when: `.claude/agents/scripts/check-code.sh client` is green, unfiltered — the last client brief runs the whole package.
Can break: `SkillDetailPane.test.tsx` (the tab-order tests at `:136-147`), `client/src/app/skills/helpers.test.ts` (tab keys), `SkillsIndex.test.tsx`.

### Stage 15 — Gate: whole packages, types of the new server tests, the build (CALLING SESSION)
Track: calling session · After: 7, 14
Files: none in the repository (`/tmp` only)
Read first: `specs/2026-10-12-eval-pipeline-plan.md:786-801` — the tsc and build-on-a-copy recipes.
Steps:
1. Every package unfiltered: the §6 rows for server, server `--it`, client, mcp. Compare the totals with the stage 1 baseline; no suite may be lost.
2. `server/node_modules/.bin/tsc -p /tmp/tsconfig.eval-tests.json` — the recipe unchanged; `server/test/eval-*.ts` covers the six new files. Expected: exit 0, no output. An error goes back to the server track as a fix brief.
3. `next build` on a `/tmp` copy of `client/`. Expected: `/skills/[id]` builds; no `Can't resolve ./contracts/…js`.
4. The `diff -u` of the contract copies; `git status --short reviewer-core mcp` prints nothing (NFR-10); the two greps of §6.
Skills: none routed.
Tests to add: none.
Done when: every §6 row above the dev-stack rows is green.

### Stage 16 — Live check, screenshots, documentation handoff (CALLING SESSION)
Track: calling session · After: 2, 15
Files: `specs/fixtures/eval-pipeline/*.png` (New); `docs/**` by `doc-writer`, outside this plan's briefs
Read first: `INSIGHTS.md:46-47,136-137`; `client/INSIGHTS.md:85-86`.
Steps:
1. The dev stack runs detached with `--no-seed`. Take the six counts (`eval_cases`, `eval_runs`, `reviews`, `findings`, `agent_runs`, `run_traces`) with `psql -U devdigest -d devdigest`.
2. `agent-browser open http://localhost:3000/skills/<id>?tab=evals` for a skill without cases. Screenshot the empty state and the host selector (absolute path).
3. Create two cases by hand in the modal, with "Run after saving" switched off before Save (no model call): one with a 64-character name, one whose diff has a `file` path longer than the pane. Screenshot the modal and the tab at the pane's real width — AC-73: no horizontal scrollbar of the pane.
4. Pick a host on `deepseek/deepseek-v4-flash`; change no agent's model. The one paid call: the run control of one row. Screenshot the trial result.
5. Counts again: `eval_cases` +2; `eval_runs` and the other four unchanged (AC-16, AC-27 on the real stack).
6. Not done live, because each needs further paid calls: "Run all evals" and the comparison. Their proof is stages 6, 7, 11, 12. Nothing is deleted from the dev DB; tell the user which skill holds the two cases.
7. Documentation handoff to `doc-writer`:
   - `client/docs/skills-ui.md:28-42` — the tab table and the paragraph that calls the Evals tab not implemented.
   - `docs/eval-pipeline.md` § "Data model" (`:15`), § "One run" (`:32`), § "Trying a case" (`:70`), § "Using it" (`:114`), § "Routes" (`:184`), § "Refusals" (`:205`), § "Known limits" (`:259`).
   - `server/README.md` § "API map", `client/README.md` § "UI route map", the spec index in `specs/README.md`.
   - The `server/INSIGHTS.md` entry on `AgentsRepository.deleteById` now has a twin in `SkillsRepository` (through `engineering-insights`).
Skills: none routed.
Tests to add: none.
Done when: the screenshots exist, the two count comparisons hold, and stage 2's diffs are on record.

## 5. Skills matrix
| Stage | onion-architecture | fastify-best-practices | zod | security | drizzle-orm-patterns | postgresql-table-design | frontend-ui-architecture | react-best-practices | react-testing-library |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `rules/drizzle-persistence.md`, `rules/testing.md` | — | — | — | `references/schema-definition.md`, `references/migrations.md` | `SKILL.md` | — | — | — |
| 3 | `rules/zod-contracts.md` | — | `SKILL.md` | — | — | — | — | — | `SKILL.md` |
| 5 | `rules/ports-and-di.md`, `rules/fastify-transport.md`, `rules/errors.md`, `rules/testing.md` | `rules/testing.md`, `rules/schemas.md` | `SKILL.md` | `checklists.md` | — | — | — | — | — |
| 6 | `rules/ports-and-di.md`, `rules/fastify-transport.md`, `rules/errors.md`, `rules/testing.md` | `rules/testing.md` | `SKILL.md` | `checklists.md` | — | — | — | — | — |
| 7 | `rules/drizzle-persistence.md`, `rules/layers.md`, `rules/fastify-transport.md`, `rules/testing.md` | `rules/testing.md` | `SKILL.md` | `checklists.md` | `references/transactions.md` | — | — | — | — |
| 8 | — | — | — | — | — | — | `logic.md`, `placement.md` | `SKILL.md` | `SKILL.md` |
| 9 | — | — | — | — | — | — | `placement.md`, `boundaries.md`, `composition.md` | `SKILL.md` | `SKILL.md` |
| 10 | — | — | — | `SKILL.md` | — | — | `composition.md`, `logic.md` | `SKILL.md` | `SKILL.md` |
| 11 | — | — | — | `SKILL.md` | — | — | `logic.md`, `composition.md` | `SKILL.md` | `SKILL.md` |
| 12 | — | — | — | — | — | — | `composition.md` | `SKILL.md` | `SKILL.md` |
| 13 | — | — | — | `SKILL.md` | — | — | `placement.md`, `logic.md` | `SKILL.md` | `SKILL.md` |
| 14 | — | — | — | — | — | — | `placement.md` | `SKILL.md` | `SKILL.md` |

Stages 2, 4, 15 and 16 route to no skill lane.

## 6. Verification
| Package | Command (from the repository root) | Proves |
|---|---|---|
| both | `diff -u server/src/vendor/shared/contracts/eval.ts client/src/vendor/shared/contracts/eval.ts` | NFR-8 — prints nothing |
| server | `.claude/agents/scripts/check-code.sh server` | typecheck, depcruise, the whole unit lane: AC-13, AC-14, NFR-4, NFR-5 (unit), NFR-8 |
| server | `.claude/agents/scripts/check-code.sh --it server` (Docker) | the whole `.it` lane, unfiltered: AC-1…AC-12, AC-15…AC-35, NFR-1…3, 5, 6, 9, 13, 14; NFR-10 — the SPEC-03, 04, 09 suites with no assertion changed |
| server | `cd server && pnpm verify:l06` | the eval suites alone, picking up the six `test/eval-skill-*` files |
| server | `server/node_modules/.bin/tsc -p /tmp/tsconfig.eval-tests.json` (calling session) | the new server tests type-check — exit 0, no output |
| server | a second `./node_modules/.bin/drizzle-kit generate` in `server/` | the snapshot matches the schema — "No schema changes" |
| client | `.claude/agents/scripts/check-code.sh client` | typecheck with tests, the whole component lane: AC-36…AC-72, NFR-1, 7, 11, 12 |
| client | `next build` on a `/tmp` copy (calling session) | no value import from `@devdigest/shared`; `/skills/[id]` builds |
| mcp | `.claude/agents/scripts/check-code.sh mcp` | NFR-10 — unchanged |
| repo | `git status --short reviewer-core mcp` | NFR-10 — empty |
| repo | `grep -rn "throw new Error(" server/src/modules/eval` ; `grep -c "^import" server/src/modules/eval/scoring.ts` | the module conventions — nothing; 0 |
| dev DB | stage 2 | NFR-9, manual half — an empty row diff on the copy and on the real database |
| dev stack | stage 16 | AC-73; AC-16 and AC-27 on the real stack; one paid call |

## 7. Risks and open questions
No blocking item: the execution mode is stated in the task (multi-agent).

- [non-blocking] The migration is planned as generated, not hand-written.
  - Stage 1 only adds columns, and the interactive prompt recorded in `server/INSIGHTS.md` is a rename question asked on a drop plus add of columns.
  - If `drizzle-kit generate` still asks or writes nothing, the implementer stops: `guard-lib.sh:97` refuses its writes under `migrations/`.
  - The calling session then writes `0019_skill_evals.sql`, builds `meta/0019_snapshot.json` from `0018_snapshot.json` (patch `eval_runs` only, `prevId` = the old `id`, a fresh uuid, the partial indexes with `"where"`), appends the journal entry and re-runs `generate` until it prints "No schema changes".
- [non-blocking] The dev stack is broken for eval routes between stage 1 and stage 2, and `./scripts/dev.sh` applies pending migrations on start. A restart before stage 2's backup would migrate without one. Recommended: run stage 2 the moment B1 reports.
- [non-blocking] A spec wording gap, planned as the spec states it.
  - NFR-5 asks for "the label a live review gives" the block. For a third-party skill that label ends "third-party text, enabled in this workspace" (`server/src/domain/reviews/prompt-parts.ts:47`), and a skill eval also runs a disabled skill (AC-12).
  - The prompt of such an eval therefore says "enabled" about a disabled skill. Recommended resolution: keep it — NG-9 and AC-14 hold the assembly fixed — unless REC2 is accepted.
- [non-blocking] `SkillsRepository.deleteById` writes to `eval_cases`, the eval module's table. This is the second instance of the exception `server/INSIGHTS.md` records for the agents repository; depcruise does not see it. AC-34's "all or nothing" needs one transaction and there is no unit-of-work port (REC3).
- [non-blocking] The shared components grow a second props variant instead of a new component per owner. A change to `CaseList`, `RunControl`, `RunHistory`, `CompareRunsDialog` or `CaseEditorDialog` can break the agent screens, so each of stages 9–12 names those suites and stage 14 runs the whole package.
- [non-blocking] `EV/service.ts` grows from 578 to roughly 800 lines. A split into a second service file would need a container registration and is left to the architecture review.
- [non-blocking] Not checked (read-only run):
  - the `SKILL.md` bodies were not re-read in full — rules are cited from `routing.md` and the rule files' section headings;
  - whether `implementer-guard.sh` lets `./node_modules/.bin/drizzle-kit generate` through — its Bash rule names only `migrate|push|drop|up` (`guard-lib.sh:56`);
  - whether `server/test/contracts.test.ts` holds an `EvalRun` fixture that needs the two fields;
  - the `IconName` of the agent editor's Evals tab (stage 14 reads it);
  - whether Fastify answers 422 for a non-uuid `host_agent_id` — the NFR-6 test decides;
  - `usePromoteAgentVersion("")` being inert in skill mode — a mutation that is never called.
- [non-blocking] `tsx watch` restarts the dev API on each save under `server/src` during stages 1 and 5–7. No suite runs against the dev API.

## 8. Handoff to reviewers
- Architecture:
  - The second cross-module table write: `skills/repository.ts` → `eval_cases` in a transaction.
  - `EvalSkillsReader` gains `getById` and `getVersion`, satisfied structurally by `SkillsRepository` with no container change.
  - Four skill twins in `EvalStore` and `isNull(skill_id)` in seven agent reads — a missed one silently counts hosted skill runs (AC-32).
  - `insertManualCase`, `providerOf` and `runTry` are extracted from agent paths that must behave as before.
  - `executeEvalRun` is reused with a one-element `skills` array; the log keys are conditional.
  - Client: `CL/` is a new cross-route folder placed outside `ER/` to avoid an `ER/` ↔ `CE/` cycle.
  - Client: the props unions on five shared components; `EvalOwner` with `string` still accepted by the hooks; `compareView` as the one mapping of two compare responses.
- Security:
  - Six new routes — workspace scoping of the skill, the host agent and the compared runs; Zod params, query and body; the body limit.
  - Two paid routes with `EVAL_RUN_RATE_LIMIT`.
  - `host_agent_id` chooses the system prompt, provider and model (UI-4).
  - A skill body, imported third-party text included, reaches a model for a disabled skill, only as the one labelled block and only on an explicit click (UI-3, NFR-5).
  - The log lines carry ids and versions, never body, diff or finding text (NFR-13).
  - Skill bodies, agent names, case names and try findings are rendered as text (NFR-7).
  - `DELETE /skills/:id` now removes eval rows — check the workspace filter on the `eval_cases` delete.
  - The new foreign key cascades on a skill delete.

## 9. Execution
Mode: multi-agent — stated in the task ("Decisions already taken"); the calling session runs the gates (stages 2, 15, 16).
Recommended: multi-agent — after stages 1, 3 and 4 the server track and the client tracks write disjoint trees and client tests mock `fetch`; after stage 8 three client tracks are disjoint.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| shared | 1 | `server/src/db/schema/eval.ts`, `server/src/db/migrations/{0019_skill_evals.sql,meta/0019_snapshot.json,meta/_journal.json}` (through `drizzle-kit generate`), `EV/{types,repository,service}.ts`, `server/test/{eval-helpers.test.ts,helpers/eval.ts,eval-skill-store.it.test.ts}` | — | alone |
| dev-db | 2 | the dev database; `/tmp` | 1 | calling session, beside any track |
| shared | 3–4 | both `vendor/shared/contracts/eval.ts`, `EV/helpers.ts`, `server/test/eval-contracts.test.ts`, the nine client fixture files of stage 3, `client/messages/en/{eval,skills}.json` | 1 | alone |
| server | 5 → 6 → 7 | `EV/{types,service,routes,runner,constants}.ts`, `server/src/modules/skills/repository.ts`, `server/test/eval-skill-{cases,runs,try,compare,delete}.it.test.ts`, `server/test/{eval-helpers.test.ts,helpers/eval.ts}` | shared | parallel |
| client-data | 8 | `client/src/lib/hooks/{evals.ts,evals.test.tsx}`, `ER/{helpers.ts,helpers.test.ts,index.ts}` | shared | parallel to server; alone inside `client/` |
| client-rows | 9 | `CL/**`, `ET/_components/CaseList/**` (removed), `ET/EvalsTab.tsx` | client-data | parallel |
| client-modal | 10 | `CE/{CaseEditorDialog.tsx,CaseEditorDialog.test.tsx,index.ts}` | client-data | parallel |
| client-runs | 11 → 12 | `CD/**`, `ER/RunControl/**`, `ER/RunHistory/{RunHistory.tsx,RunHistory.test.tsx,styles.ts}` | client-data | parallel |
| client-tab | 13 → 14 | `ST/**`, `SK/{SkillDetail.tsx,SkillDetail.test.tsx}`, `client/src/app/skills/constants.ts`, `client/src/app/skills/_components/SkillDetailPane/SkillDetailPane.test.tsx` | client-rows, client-modal, client-runs | alone inside `client/` |
| gate | 15, 16 | `/tmp`, `specs/fixtures/eval-pipeline/**` | server, client-tab, dev-db | alone, calling session |

Briefs — a fresh `implementer` each, in order inside a track; the plan path is `specs/2026-10-13-skill-evals-plan.md`. Every client brief from B7 on carries the line "A missing message key is reported, never added."
- B1 · stage 1 → "Execute stage 1 (track shared). Write only inside: `server/src/db/schema/eval.ts`, `server/src/modules/eval/{types,repository,service}.ts`, `server/test/{eval-helpers.test.ts,helpers/eval.ts,eval-skill-store.it.test.ts}`; the migration files only through `./node_modules/.bin/drizzle-kit generate --name skill_evals` in `server/` — if it asks a question or is refused, stop and report. Report the unit and `.it` test totals. Check with: `check-code.sh --it server -- eval-`."
- B2 · stages 3–4 → "Execute stages 3–4 (track shared). Write only inside: both `vendor/shared/contracts/eval.ts`, `server/src/modules/eval/helpers.ts`, `server/test/eval-contracts.test.ts`, the nine client test files listed in stage 3 (the run factory only), `client/messages/en/{eval,skills}.json`. Check with: the `diff -u`, `check-code.sh server`, `check-code.sh client` — both unfiltered."
- B3 · stage 5 → "Execute stage 5 (track server). Write only inside: `server/src/modules/eval/{types,service,routes}.ts`, `server/test/{helpers/eval.ts,eval-skill-cases.it.test.ts}`. Can break: `eval-case-create.it`, `eval-cases.it`, `eval-case-update.it`, `eval-case-draft.it`. Check with: `check-code.sh --it server -- eval-`."
- B4 · stage 6 → "Execute stage 6 (track server). Write only inside: `server/src/modules/eval/{constants,service,routes,runner}.ts`, `server/test/{helpers/eval.ts,eval-helpers.test.ts,eval-skill-runs.it.test.ts,eval-skill-try.it.test.ts}`. Can break: `eval-runs.it`, `eval-case-try.it`, `eval-promote.it`, `reviews-skills.it`. Check with: `check-code.sh --it server -- eval- reviews-skills`."
- B5 · stage 7 → "Execute stage 7 (track server). Write only inside: `server/src/modules/eval/{service,routes}.ts`, `server/src/modules/skills/repository.ts`, `server/test/{eval-skill-compare.it.test.ts,eval-skill-delete.it.test.ts}`. Can break: `eval-compare.it`, `skills.it`, the agents delete suites. Check with: `check-code.sh --it server -- eval- skills.it agents`, then `check-code.sh --it server` unfiltered as the last server brief."
- B6 · stage 8 → "Execute stage 8 (track client-data). Write only inside: `client/src/lib/hooks/{evals.ts,evals.test.tsx}`, `client/src/components/eval-runs/{helpers.ts,helpers.test.ts,index.ts}`. Existing call sites and agent query keys must not change. Check with: `check-code.sh client` unfiltered."
- B7 · stage 9 → "Execute stage 9 (track client-rows). Write only inside: `client/src/components/eval-case-list/**`, the agent `EvalsTab/_components/CaseList/**` (moved away with `mv`), the import line of the agent `EvalsTab/EvalsTab.tsx`. Can break: the agent `EvalsTab.test.tsx`, `AgentEditor.test.tsx`. Check with: `check-code.sh client -- CaseList.test EvalsTab.test AgentEditor.test`."
- B8 · stage 10 → "Execute stage 10 (track client-modal). Write only inside: `client/src/components/eval-case-editor/{CaseEditorDialog.tsx,CaseEditorDialog.test.tsx,index.ts}`. Can break: `EvalCaseAction.test.tsx`, the `FindingCard` / `FindingsPanel` / `DiffTab` suites, the agent `EvalsTab.test.tsx`. Check with: `check-code.sh client -- CaseEditorDialog.test TryResult.test EvalCaseAction.test`."
- B9 · stages 11–12 → "Execute stages 11–12 (track client-runs). Write only inside: `client/src/components/eval-runs/RunHistory/**`, `client/src/components/eval-runs/RunControl/**`. Agent mode must render and request what it does today. Can break: `AgentEvalView.test.tsx`, the agent `EvalsTab.test.tsx`, `AgentEditor.test.tsx`. Check with: `check-code.sh client -- CompareRunsDialog.test RunHistory.test RunControl.test AgentEvalView.test EvalsTab.test AgentEditor.test`."
- B10 · stages 13–14 → "Execute stages 13–14 (track client-tab), after B7, B8 and B9 have reported. Write only inside: `client/src/app/skills/_components/SkillDetail/**`, `client/src/app/skills/constants.ts`, `client/src/app/skills/_components/SkillDetailPane/SkillDetailPane.test.tsx`. Can break: `SkillDetailPane.test.tsx`, `skills/helpers.test.ts`, `SkillsIndex.test.tsx`. Check with: `check-code.sh client` unfiltered."

Order for the calling session: B1 → (stage 2 ∥ B2) → (B3 → B4 → B5) ∥ (B6 → (B7 ∥ B8 ∥ B9) → B10) → stage 15 → stage 16.
single-agent: the same briefs one after another, B1 → B10, with stage 2 after B1; the Runs column is not used.

## 10. Recommendations — not applied
- REC1 [approach] Add a check constraint `(skill_id is null) = (skill_version is null)` to `eval_runs`.
  - Why: the two columns are written together in one place only (`EV/repository.ts` `insertRunningRun`), and `compareSkillRuns` has to refuse a run with a skill id and no version in code.
  - Would change: stage 1 (one more statement in 0019 and the snapshot) and stage 2's `\d` check.
- REC2 [requirements] Give the block of a skill eval its own provenance wording for a disabled third-party skill.
  - Why: `server/src/domain/reviews/prompt-parts.ts:47` says "enabled in this workspace", which is false for a disabled skill that AC-12 lets an eval run.
  - Would change: NFR-5 and NG-9 in a superseding spec, stage 6, and the AC-14 test's premise.
- REC3 [approach] Replace the two cross-module deletes (`agents/repository.ts:77-93`, and stage 7's in `skills/repository.ts`) with one consumer-declared port (`deleteCasesOfOwner`) implemented by `EvalRepository` and run inside a shared transaction handle.
  - Why: `server/INSIGHTS.md § Codebase Patterns` names this as the rule-conforming shape, and the feature doubles the exception.
  - Would change: stage 7, the agents module, and a unit-of-work port that does not exist yet — a change of its own, larger than this feature needs.

## Questions for the user
The calling session asks these with AskUserQuestion and sends the answers back. No [blocking] question stands: the execution mode is stated in the task.

Recommendations awaiting a decision: REC1, REC2, REC3 (section 10) — accept before B1 starts (REC1), before B4 (REC2) or before B5 (REC3), or the plan stands as written.
Gaps for `spec-creator`, not questions of mine: none blocking. The NFR-5 label wording (section 7) is planned as the spec states it and goes to `spec-creator` only if REC2 is accepted.
