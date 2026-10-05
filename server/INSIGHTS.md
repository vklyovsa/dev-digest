# Insights — server

Learnings for `@devdigest/api`: routes, modules, adapters, the DI container,
Drizzle/Postgres, and the review run pipeline.

**Fixed sections — append to the matching one, never to the bottom of the file.**
If an entry fits nowhere here, it probably belongs in `docs/` or nowhere at all.

How to write one: 1–3 lines, newest first inside its section, recording what a
careful reader could not have predicted from the code. Not a task log, not a
changelog, not a restatement of the diff. When an entry has bitten a third time,
promote it to `CLAUDE.md` — § Conventions for a pattern, § Gotchas for a trap —
and leave it here as history.

## What Works

Approaches and solutions that held up, with the context that made them work.

_None yet._

## What Doesn't Work

Dead ends and anti-patterns: what was tried, why it failed, what to do instead.
**The highest-value section and the one most often left empty. Fill it.**

- **Corrected 2026-10-04: the hermetic lane is hermetic now — `vitest.config.ts` sets `test.env.DATABASE_URL` to `postgres://isolated:isolated@127.0.0.1:1/isolated`, and it wins over both `.env` and a `DATABASE_URL` exported in the shell.** `dotenv/config` in `src/platform/config.ts` never overrides a variable that is already set, so `routes-smoke.test.ts` boots against the unreachable address; `test/hermetic-env.test.ts` fails if the pin is removed. Unit lane 312 passed with no prefix, `.it` lane 89 passed — those tests pass their own testcontainers `db`.
  → Drop the `DATABASE_URL=…isolated` prefix; a test that really needs a database gets one from `test/helpers/pg.ts`, never from the environment.

- **The hermetic lane is not hermetic: `test/routes-smoke.test.ts` boots the app against your REAL dev database, and boot writes to it.** (2026-09-23) It calls `buildApp({ config })` without a `db`, so `src/app.ts` opens `DATABASE_URL` from `server/.env` and awaits `ReviewService.reapStaleRuns()` before serving — which marks every `agent_runs` row in `running` as failed. Run the unit suite while a review is in flight and that review dies; nothing in the test output says so.
  → Run the unit lane as `DATABASE_URL=postgres://isolated:isolated@127.0.0.1:1/isolated pnpm exec vitest run --exclude '**/*.it.test.ts'` — the reaper failure is non-fatal and `/health` needs no DB, so all 197 still pass. The `.it` lane is safe: every file passes its own testcontainers `db`. The durable fix (give the smoke test an unreachable `databaseUrl`, or skip the reaper under `NODE_ENV=test`) is still open.

## Codebase Patterns

Conventions and architectural decisions found while working here, before they are
settled enough to move into `CLAUDE.md`.

- **`RepoIntel.getBlastRadius` returns DIRECT callers only, and an endpoint is attributed only when the caller's own file declares it — so a helper reached through a service maps to zero endpoints.** (2026-10-04) `BFS_DEPTH` is read only by `getCriticalPaths` (`src/modules/repo-intel/service.ts`), although the L04 homework text describes a depth-2 traversal. Measured through `GET /pulls/:id/blast` on the dev index: PR #1 (90 files) → 77 symbols, 17 callers, 0 endpoints, because its callers are `service.ts` files; `server/src/platform/errors.ts` → 5 symbols, 17 callers, 19 endpoints, because four `routes.ts` files throw `NotFoundError` themselves.
  → To demo or test endpoint attribution pick a file that route files import directly (`platform/errors.ts`, `modules/_shared/context.ts`), not a module helper; an empty endpoint list is the facade's reach, not a mapper bug in `src/modules/blast/helpers.ts`. A transitive walk would be a facade change, not a blast change.

- **`MockGitHubClient.getPullRequest()`s base fixture carries no `labels` key, so `PrDetail.labels` reads back `undefined` (→ `[]` after the pulls-module `?? []`) unless a test overrides it.** (2026-09-27) `server/src/adapters/mocks.ts` — the fixture object built for the Intent Layer (`server/src/modules/intent/`) has no default entry for the new `PrDetail.labels` field, so any test asserting a `labels`-derived confidence path needs `new MockGitHubClient({ detail: { labels: [...] } })` explicitly.
  → Set `detail.labels` in the mock when writing the deferred `intent.it.test.ts` / `reviews-intent.it.test.ts` (Stage 6/7 of `specs/intent-layer-plan.md`) — otherwise the labels source silently stays empty and no assertion catches it.

- **A derived count belongs on the DTO, filled by one grouped IN-query — and it has to be filled on EVERY read path, not just the list.** (2026-09-22) `Skill.agent_count` and `Agent.skill_count` are the same join read from opposite ends (`agentCounts` / `skillCounts`); the trap is `update()`, which returns a DTO too — leaving it at the `toDto(row)` default made a freshly-saved agent report 0 skills until the next list refetch, with nothing in the types to notice.
  → When adding a derived field, grep the module for every `to<Thing>Dto(` call site before declaring it done: create legitimately defaults to 0, but get/list/update must all resolve it. `z.number().int().nonnegative().default(0)` over `.nullish()` keeps the inferred type a plain number so no reader needs `?? 0`.

- **Findings are never deduplicated between runs, so "all reviews of a PR" over-counts.** (2026-09-19) `src/modules/reviews/repository/review.repo.ts:36` inserts a fresh `findings` row per run and the table has no unique key (`src/db/schema/reviews.ts:27`), so an agent re-run on an unchanged PR stores the same problem again — three passes of one security agent read as "3 CRITICAL".
  → For the current state of a PR, take the NEWEST review per (pr_id, agent_id) and only its findings (`src/modules/pulls/routes.ts:131`): an agent supersedes itself, never its colleagues.

- **One review row per AGENT RUN, so "the latest review" of a PR is a lottery.** (2026-09-17) `src/modules/reviews/run-executor.ts:219` inserts a review per run, and a "Run all agents" batch finishes in whatever order the models answer — the local DB holds 3 review rows for a single PR with scores 100, 88 and 65. Anything PR-level that reads the newest row therefore shows a random agent's opinion.
  → For a PR-level number, derive it from the PR's findings instead (`src/modules/pulls/routes.ts:177` scores the list rows through the engine's `scoreFromFindings`), or aggregate every row explicitly — never `ORDER BY created_at DESC LIMIT 1`.

- **`findings.severity` is a free-text column, not a pg enum.** (2026-09-17) `src/db/schema/reviews.ts:36` declares `text('severity').notNull()`, so Postgres accepts any string and the Zod `Severity` enum is the only guard; a row written by an older agent or by hand can carry a value the UI has no colour for.
  → Code that groups or ranks severities must handle an unknown value explicitly (`src/modules/pulls/findings-summary.ts:31` sorts it last), never index a severity table without a fallback.

- **A studio review is ONE LLM call, whatever the test name says.** `REVIEW_STRATEGY` in `src/modules/reviews/constants.ts` is `'single-pass'`, so the whole diff goes in a single call; the integration test titled "runs a review: map-reduce …" in `test/reviews.it.test.ts` exercises single-pass, and `MockLLMProvider` bills 100/50 tokens and `costUsd` 0.001 per call.
  → Size token/cost expectations from the strategy, never from the file count in the fixture diff, and do not read a test's title as the mode it runs.

## Tool & Library Notes

Quirks of dependencies, versions and tooling — what a library does that its docs
do not say.

- **`drizzle-kit generate` becomes INTERACTIVE the moment one migration both drops and adds columns — and no form of piped input answers it.** (2026-09-22) Dropping `conventions.accepted` while adding eight columns made it ask "Is category column in conventions table created or renamed from another column?" once per new column; `printf '\\n\\n\\n' | pnpm exec drizzle-kit generate` returned instantly having written nothing (it reads the TTY, not stdin), and `script -qec "pnpm exec drizzle-kit generate" /dev/null` with the same input hung past a 120s timeout.
  → Write the migration by hand, then build `meta/<NNNN>_snapshot.json` from the previous snapshot: patch only the changed tables, set `prevId` to the old `id` and a fresh uuid as `id`, and append the `_journal.json` entry (`{idx, version: "7", when, tag, breakpoints: true}`). Verify by running `drizzle-kit generate` again — `No schema changes, nothing to migrate` means the snapshot matches the schema; anything else means it does not. A partial unique index carries `"where": "<sql>"` inside its index object.

- **`pnpm typecheck` does not look at `test/**` — the tsconfig `include` is `src/**/*.ts` only.** (2026-09-21) A type error in a new test file is therefore invisible until vitest runs it, and vitest strips types rather than checking them, so it can stay invisible for good. Running tsc over a test-inclusive config shows the backlog this hides: `test/adapters.test.ts:37`, `test/agents-versions.it.test.ts:168`, seven spots in `test/prompt-callers.test.ts`, `test/repo-intel-facade-degraded.test.ts:112` are all red today on `main`-equivalent code.
  → To check a NEW test statically, drop a throwaway config in `server/` that extends `tsconfig.json` with `"include": ["src/**/*.ts", "test/**/*.ts"]`, run `pnpm exec tsc --noEmit -p` it, and grep the output for your own files — the pre-existing errors make an unfiltered run unreadable. Delete the config afterwards.

## Recurring Errors & Fixes

Error or symptom → cause → fix, one entry each, so the next occurrence is a lookup
instead of an investigation.

- **Corrected 2026-10-04: the `reviews-skills.it.test.ts` flake in § Open Questions has a cause — `agent_runs.status` turns `done` BEFORE the run trace is stored, so a test that waits only for the run reads `GET /runs/:id/trace` too early.** `run-executor.ts` calls `completeAgentRun` (~line 441) and only then `saveRunTrace` (~line 492); `waitForPrRuns` polls `agent_runs` alone, so the trace route can still answer 404 and `trace.prompt_assembly` is undefined. Reproduced once on the second of two back-to-back runs of that file: `TypeError: Cannot read properties of undefined (reading 'skills')` in "linked enabled skills become labelled blocks"; it passed alone right after.
  → After `waitForPrRuns`, poll `GET /runs/:id/trace` until it answers 200 (`waitForTrace` in `test/reviews-context.it.test.ts`, stable over repeated runs); `runAndTrace` in `test/reviews-skills.it.test.ts` still reads once and can flake until it does the same.

- **`Property 'statusCode' does not exist on type 'void & Promise<Response> & Chain'` on an `app.inject()` result means the call matched no overload — typically a helper typed `payload: unknown`.** (2026-10-04) Seen in `test/context.it.test.ts` (`const put = (url, payload: unknown) => app.inject({ method: 'PUT', url, payload })`): vitest ran it green because it strips types, and `pnpm typecheck` never reads `test/**`; only a test-inclusive tsc showed it. The config can live outside the repo: `{"extends": "<abs>/server/tsconfig.json", "compilerOptions": {"noEmit": true, "rootDir": "<repo>"}, "include": ["<abs>/server/src/**/*.ts", "<abs>/server/test/<file>.ts"]}` in `/tmp`, run with `server/node_modules/.bin/tsc -p`.
  → Type an inject helper's payload as `Record<string, unknown>` (the `InjectPayload` union rejects bare `unknown`); to check a new test when `server/` is write-scoped, use the `/tmp` config instead of the one in `server/` described above.

- **A new table gets a column called `created_at` when you meant `started_at`: `now()` hardcodes the NAME, not just the type.** (2026-09-22) `src/db/schema/_shared.ts:9` is `timestamp('created_at', …)`, so `startedAt: now()` in `convention_scans` compiled, typechecked and read correctly in every query — the only symptom was `drizzle-kit generate` asking "Is created_at column in convention_scans table created or renamed from started_at?".
  → Use `now()` only for a column that is genuinely `created_at`; write any other timestamp out as `timestamp('<name>', { withTimezone: true }).defaultNow().notNull()`. The migration diff is the only place this disagreement surfaces, so read the generated SQL for column NAMES before trusting a new table.

## Session Notes

Dated summaries as `### YYYY-MM-DD — topic`: what was worked on and what state it
was left in. Prune an entry once its content has moved into a section above.

_None yet._

## Open Questions

Unresolved behaviour, undecided design, unverified assumptions. Delete an entry when
it is answered — the answer belongs in another section.

- **Unverified: `POST /repos` may delete a directory next to `clones/` — `GITHUB_URL_REGEX` accepts `..` as the owner.** (2026-10-04) `src/modules/repos/constants.ts:18` captures the owner with `[^/]+`, `clonePathFor` joins it onto the clone dir (`src/adapters/git/simple-git.ts:55-57`), and `clone()` removes an existing destination that has no `.git` with `rm(dest, { recursive: true, force: true })` (`:82`), so `https://github.com/../src` would resolve to `server/src`. Read from code by the security review of SPEC-01, never executed; whether a GitHub lookup rejects the URL before `clone()` runs was not traced.
  → Before touching repo import, trace `src/modules/repos/service.ts` from the URL to `git.clone`; if nothing rejects it first, restrict the owner capture to GitHub's login alphabet and assert that `dest` stays inside `cloneDir`.

- **Unverified: `test/reviews-skills.it.test.ts` "without linked skills the prompt carries no skills block" failed once in the full `.it` lane and passed alone and on a second full run.** (2026-09-28) Failure was `trace.prompt_assembly` undefined at `test/reviews-skills.it.test.ts:175` (`runAndTrace` read the trace before it existed); unrelated to the code under change, seen while 12 `.it` files ran in parallel.
  → If it recurs, check whether `runAndTrace` waits for the run to settle before fetching the trace; re-run the file alone before blaming a change.
