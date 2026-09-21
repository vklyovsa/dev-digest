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

_None yet._

## Codebase Patterns

Conventions and architectural decisions found while working here, before they are
settled enough to move into `CLAUDE.md`.

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

_None yet._

## Recurring Errors & Fixes

Error or symptom → cause → fix, one entry each, so the next occurrence is a lookup
instead of an investigation.

_None yet._

## Session Notes

Dated summaries as `### YYYY-MM-DD — topic`: what was worked on and what state it
was left in. Prune an entry once its content has moved into a section above.

_None yet._

## Open Questions

Unresolved behaviour, undecided design, unverified assumptions. Delete an entry when
it is answered — the answer belongs in another section.

_None yet._
