# Insights — repository

Cross-cutting learnings: the stack as a whole, tooling, and anything that spans
more than one package. Package-specific notes go in that package's `INSIGHTS.md`.

**Fixed sections — append to the matching one, never to the bottom of the file.**
If an entry fits nowhere here, it probably belongs in `docs/` or nowhere at all.

How to write one: 1–3 lines, newest first inside its section, recording what a
careful reader could not have predicted from the code. Not a task log, not a
changelog, not a restatement of the diff. When an entry has bitten a third time,
promote it to `CLAUDE.md` — § Conventions for a pattern, § Gotchas for a trap —
and leave it here as history.

## What Works

Approaches and solutions that held up, with the context that made them work.

- **To prove a screen made no model call, diff `agent_runs` / `run_traces`; the log alone is not enough.** (2026-09-19) Provider, prompt and token lines are only emitted from inside a run (`server/src/modules/reviews/run-executor.ts`), so a quiet log proves nothing on its own — while every real run inserts exactly one `agent_runs` row and exactly one `run_traces` document, which is a signal that cannot be missed.
  → Snapshot both counts, exercise the screen, snapshot again, and only then read the log tail; a static `grep` for provider imports in the feature's files is stronger still. Kept as a recipe on purpose — a one-off checker script in `scripts/` would rot next to `dev.sh` and `e2e.sh`.

## What Doesn't Work

Dead ends and anti-patterns: what was tried, why it failed, what to do instead.
**The highest-value section and the one most often left empty. Fill it.**

_None yet._

## Codebase Patterns

Conventions and architectural decisions found while working here, before they are
settled enough to move into `CLAUDE.md`.

- **Run cost is already plumbed end-to-end — only the sink was removed.** `reviewer-core/src/llm/openrouter.ts` asks OpenRouter for `usage: { include: true }` and returns the real `usage.cost` (falling back to the injected PriceBook), and `reviewer-core/src/review/run.ts:184` sums it per chunk, but `server/src/db/migrations/0009_complex_runaways.sql` DROPs `agent_runs.cost_usd` and `server/src/modules/reviews/run-executor.ts:213` destructures only tokens + grounding, discarding `outcome.costUsd`. Contracts that declare `cost_usd` (AgentColumn, AgentStats, eval/ci/knowledge) are aspirational, not proof it is persisted.
  → Surfacing cost means re-adding the column and forwarding `outcome.costUsd`; never build a second pricing path or a per-run estimation call.

## Tool & Library Notes

Quirks of dependencies, versions and tooling — what a library does that its docs
do not say.

_None yet._

## Recurring Errors & Fixes

Error or symptom → cause → fix, one entry each, so the next occurrence is a lookup
instead of an investigation.

- **`psql -U postgres` into `devdigest-postgres` answers `role "postgres" does not exist`.**
  `docker-compose.yml` sets `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` all to `devdigest`,
  so the default role habit fails in a way that reads like a broken or half-initialised container.
  → `docker exec devdigest-postgres psql -U devdigest -d devdigest`, matching `DATABASE_URL` in `server/.env`.

- **`relation "repositories" does not exist` while every migration is applied — the table is `repos`.**
  `CLAUDE.md` § Gotchas reads that message as "migrations were not applied"; a guessed plural-noun
  table name fails identically. Real names: `repos`, `pull_requests`, `reviews`, `findings`.
  → Run `\dt` before writing an ad-hoc count query instead of inferring the name from the entity.

- **App looks empty after a restart ("nothing works"), but every endpoint answers 200.**
  Usually the data is gone, not the app: no repos, or the only repo has no imported PRs.
  → `GET /repos` plus `select count(*) from pull_requests`, and grep the API log for
  `DELETE /repos/` — a browser tab issuing the confirm-gated remove looks identical to
  a boot failure from the UI. Importing PRs needs a `GITHUB_TOKEN`, which is absent from
  `server/.env` by default.

## Session Notes

Dated summaries as `### YYYY-MM-DD — topic`: what was worked on and what state it
was left in. Prune an entry once its content has moved into a section above.

### 2026-09-17 — findings grouped by severity on four surfaces
Spec first (`specs/findings-by-severity.md` plus the per-package halves), then built:
`GET /repos/:id/pulls` now returns a `findings` summary for each PR's LATEST review (one extra
IN-query + `src/modules/pulls/findings-summary.ts`), the PR list has a FINDINGS column with a
read-only hover popover, timeline tiles show the same counts, and a review-run card's pills
filter its own findings. Counting is a group-by — no model call anywhere. Green: client 52 tests,
server 106 hermetic + the two PR-list DB suites (9), typechecks in client/server/reviewer-core.
Two lab-1 cost assertions in `RunHistory.test.tsx` were red before this session and were fixed.
No commits — branch `feature/lab1`, and the uncommitted lab-1 cost changes are still in the tree.

### 2026-09-16 — run cost surfaced on three screens
Spec and plan written to `specs/run-cost.md` / `specs/run-cost-plan.md`, then implemented:
`agent_runs.cost_usd` restored by migration `0010` (generated and applied locally),
`run-executor` forwards the engine's `costUsd` into the row and the trace, and the PR list,
run timeline and trace drawer render it. Typechecks green in server, client and reviewer-core;
tests were WRITTEN but not run (standing rule). No commits. Stack was down and was restarted
with `./scripts/dev.sh --no-seed` — DB still holds 1 repo and 0 pull requests, so the new COST
column has no data to show locally.

### 2026-09-16 — second "app is down" report the same day
This time the processes really were down: nothing listening on :3000/:3001 while
`devdigest-postgres` had been healthy for hours. `./scripts/dev.sh --no-seed` restored both
(API :3001, web :3000; migrations are idempotent and only logged `__drizzle_migrations already exists`).
DB state is unchanged from the earlier restart — 1 repo (`vklyovsa/dev-digest`), 0 pull_requests — so
the UI still renders empty. Nothing was seeded.

### 2026-09-16 — stack brought up after an "app stopped working" report
Stack was healthy the whole time (Postgres, migrations, API :3001, web :3000). The
symptom was an empty database: the seeded `acme/payments-api` had been removed by a
`DELETE /repos/:id` from a browser session, and the remaining repo has no imported PRs.
Nothing was reseeded — see the standing rule not to seed unless asked.

## Open Questions

Unresolved behaviour, undecided design, unverified assumptions. Delete an entry when
it is answered — the answer belongs in another section.

- **Unresolved: `INFO` is a fourth severity that only the client design system knows about.** (2026-09-17) The contract enum carries three values (`server/src/vendor/shared/contracts/findings.ts:11`), while `client/src/vendor/ui/primitives/tokens.ts:13` declares `INFO` and two client constant maps keep an entry for it; nothing in the engine, the API or the DB can produce one, so those branches are unreachable today.
  → Decide whether to promote it (contract + the four engine tables listed in `reviewer-core/docs/severity.md`) or delete it; `reviewer-core/specs/severity-source-of-truth.md` carries the spec either way.
