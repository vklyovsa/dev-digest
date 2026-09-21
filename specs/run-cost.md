# Run cost — spec

Surface what an agent run cost, in the three places a reviewer already looks:
the PR list, the run timeline, and the run trace. Cross-cutting: `server`,
`client`, and both copies of `@devdigest/shared`. `reviewer-core` is untouched.

## Goal

Every completed agent run carries a USD cost that is persisted at run level and
shown in the UI, with **zero additional model calls** — the number already
exists in the response we pay for.

## Background — the number is already there

- `OpenRouterProvider.completeStructured` asks OpenRouter for real usage
  accounting (`usage: { include: true }`) and returns `costUsd`: the API's own
  `usage.cost` when present, else the injected estimator (live `PriceBook`
  prices, falling back to the static table in `adapters/llm/pricing.ts`).
- `reviewPullRequest` already sums `costUsd` across chunks and null-poisons the
  total when any chunk has no price.
- `run-executor` destructures `tokensIn`/`tokensOut`/`grounding` and **drops**
  `costUsd`; `agent_runs.cost_usd` was removed by migration `0009`.

So this feature is persistence + presentation of an existing value, not new
metering.

## Non-goals

- Aggregate cost screens (Agent Performance, Eval, CI, Multi-Agent) — their
  contracts already declare cost fields; wiring them is separate work.
- Budgets, limits, or warnings when a run gets expensive.
- Cost on the Review Runs verdict plate (the accordion header). Explicitly out
  of scope for this pass even though the design mock shows it.
- Cost for `source='ci'` runs.
- Backfilling runs that predate the migration.
- Live cost while a run is in flight — the value lands at completion.

## Behaviour and acceptance criteria

### B1 — Persistence

- `agent_runs.cost_usd` (`double precision`, nullable) is written when a run
  completes.
- `status='done'` → the engine's `costUsd`; `null` when the model has no known
  price. `null` is a real state, not zero.
- `status='failed' | 'cancelled'` → `null`, mirroring the existing `0/0` token
  behaviour of that path.
- Rows written before this change stay `NULL` and render as `—`.

### B2 — COST column in the PR list

- `GET /repos/:id/pulls` returns `cost_usd` per PR = the **total of every run**
  ever made against it. The column answers "what has this PR cost us", which is
  the question a reviewer scanning the list is actually asking; a re-reviewed PR
  is genuinely more expensive than a once-reviewed one, and showing only the last
  run would hide that.
- Unpriced runs contribute nothing. A PR whose runs are *all* unpriced reports
  `null` → `—`, never a confident `$0.00`.
- Note the deliberate asymmetry with SCORE, which shows the *latest* review:
  a score is a current verdict, a cost is a running tally.
- Column sits between STATUS and UPDATED; header "Cost".
- One additional query for the whole list (the same read pattern as the
  latest-score lookup) — never per row.

### B3 — Cost on the timeline run row

- On PR Detail → Agent runs, a settled run shows `9,119 tok · $0.0013` under the
  run time, right-aligned in the same column.
- `running` rows show nothing; `failed` / `cancelled` rows show nothing (they
  have neither tokens nor cost).
- A `done` run whose cost is unknown shows `9,119 tok · —`.
- `RunSummary` gains `cost_usd`.

### B4 — COST tile in the trace drawer

- Stats section reads DURATION · TOKENS · COST · FINDINGS.
- The value comes from the persisted trace document (`stats.cost_usd`), because
  the drawer loads `GET /runs/:id/trace` and nothing else.
- Traces written before this change have no such field → `—`.

### B5 — One formatter, everywhere

- `null` / `undefined` → `—` (never `$0.00`).
- `0` → `$0.00` — a free model genuinely costs nothing; that is data, not a gap.
- `< $0.01` → 4 decimals (`$0.0013`); `< $1` → 3 decimals (`$0.012`); otherwise
  2 decimals (`$1.24`). Always `$`-prefixed, tabular numerals.
- Deliberate deviation from the mock: the trace drawer's `$0.06` renders as
  `$0.060`. One rule in one helper beats three per-screen rules.

### B6 — Contracts land in both copies

`server/src/vendor/shared` and `client/src/vendor/shared` change in the same
commit:

- `RunSummary.cost_usd` — nullable.
- `RunStats.cost_usd` — **nullish**, so traces persisted before this change still
  parse (`contracts.test.ts` parses fixtures without the field).
- `PrMeta.cost_usd` — nullish, list-endpoint only, exactly like `score`.

## Affected packages and files

**server**

- `src/db/schema/runs.ts` — `costUsd` column
- `src/db/migrations/00XX_*.sql` — new generated migration (never edit `0009`)
- `src/modules/reviews/repository/run.repo.ts` — write on complete, read in list
- `src/modules/reviews/repository.ts` — facade signature
- `src/modules/reviews/run-executor.ts` — stop dropping `costUsd`; into the trace
- `src/modules/pulls/routes.ts` — total run cost per PR
- `src/vendor/shared/contracts/{trace,platform}.ts`

**client**

- `src/components/run-cost/` — new shared badge + formatter
- `src/app/repos/[repoId]/pulls/{constants,styles}.ts`, `_components/PRRow/`
- `src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/`
- `.../RunTraceDrawer/_components/TraceBody/`
- `messages/en/{prReview,runs}.json`
- `src/vendor/shared/contracts/{trace,platform}.ts`

**reviewer-core** — no changes.

## Operational note

Migrations never run on boot: `cd server && pnpm db:migrate` has to be run by
hand after the schema change, or every route touching `agent_runs` fails with
`column "cost_usd" does not exist`.

## Open questions

None. Decisions taken up front: three surfaces only; `null` for
failed/cancelled runs; no backfill of history. The PR-list column started as
"latest settled run" and was changed to the per-PR total once the first real runs
landed — one PR reviewed three times reads `$0.014`, not `$0.0065`.
