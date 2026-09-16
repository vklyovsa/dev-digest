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
