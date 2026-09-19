# Run cost — implementation plan

Companion to `run-cost.md` (which states intent only). Six stages, each ending in
something verifiable. Stages 1–3 are server-side and independent of 4–5.

## Stage 0 — before the first edit

- Read `server/INSIGHTS.md` and `client/INSIGHTS.md` in full.
- Confirm Postgres is up and migrations are applied; do **not** reseed.

## Stage 1 — contract + schema (both copies, one commit)

1. `RunSummary` += `cost_usd: z.number().nullable()` and
   `RunStats` += `cost_usd: z.number().nullish()` in
   `{server,client}/src/vendor/shared/contracts/trace.ts`.
2. `PrMeta` += `cost_usd: z.number().nullish()` in
   `{server,client}/src/vendor/shared/contracts/platform.ts`.
3. `server/src/db/schema/runs.ts`: `costUsd: doublePrecision('cost_usd')`
   (add the `doublePrecision` import).
4. `cd server && pnpm db:generate` → a new `00XX_*.sql` holding
   `ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" double precision;`
5. Apply it: `cd server && pnpm db:migrate`.

**Checkpoint:** `cd server && pnpm typecheck` and `cd client && pnpm typecheck`,
plus a drift check on the two contract copies:

```
diff -u server/src/vendor/shared/contracts/platform.ts client/src/vendor/shared/contracts/platform.ts
diff -u server/src/vendor/shared/contracts/trace.ts    client/src/vendor/shared/contracts/trace.ts
```

`platform.ts` must come back empty and `trace.ts` must show only the two
pre-existing comment hunks (`T1.3` / `T3` wording). Anything mentioning
`cost_usd` means the change landed in one copy only.

`nullish()` on `RunStats` is what keeps `server/test/contracts.test.ts` green —
its `RunTrace` fixtures have no `cost_usd`.

## Stage 2 — persist the cost

1. `run.repo.ts` → `completeAgentRun`: accept `costUsd?: number | null`, write
   `costUsd: values.costUsd ?? null`.
2. `run.repo.ts` → `listRunsForPull`: map `cost_usd: run.costUsd`.
3. `repository.ts`: mirror the signature on the facade.
4. `run-executor.ts`:
   - `const { tokensIn, tokensOut, grounding, costUsd } = outcome;`
   - pass `costUsd` to `completeAgentRun` and set `stats.cost_usd: costUsd` on
     the `RunTrace` document;
   - both failure paths (`failAll` and the `runOneAgent` catch) pass
     `costUsd: null` explicitly, so the intent is readable at the call site.

**Test:** extend `server/test/reviews.it.test.ts` ("runs a review: map-reduce …")
where it already asserts the `agent_runs` row — assert `run.costUsd` equals the
mock provider's per-call `costUsd` (`0.001` in `adapters/mocks.ts`) times the
number of chunks, and that `trace.stats.cost_usd` matches. Add a second case:
a failed run keeps `cost_usd` null.

## Stage 3 — cost in the PR list endpoint

In `pulls/routes.ts`, next to the existing `latestReviewByPr` block, add a
`costByPr` map: one query over `agent_runs` for `prId IN (…)`, summed per PR in
JS (same grouping trick as the score). Rows with a null cost are skipped, so a PR
with no priced run at all never lands in the map and reports `null`. Return
`cost_usd` on each list item.

**Test:** a DB-backed case — the file must carry the `*.it.test.ts` suffix or it
lands in the hermetic lane and fails there. Cover: no runs → `null`; two `done`
runs → their sum; a `failed` run adds nothing instead of voiding the total; all
runs unpriced → `null`, not `0`.

## Stage 4 — the shared badge

New `client/src/components/run-cost/`:

- `helpers.ts` — `formatUsd(cost: number | null | undefined): string` per
  spec §B5, plus `totalTokens(in, out)` for the `9,119 tok` half.
- `RunCostBadge.tsx` — two variants:
  - `compact` → `$0.012` (PR list cell),
  - `detailed` → `9,119 tok · $0.0013` (timeline row).
  Strings come from `next-intl`; no hardcoded copy in JSX.
- `index.ts`, `RunCostBadge.test.tsx`.

**Test:** `client/src/components/run-cost/RunCostBadge.test.tsx` — the four
formatting bands, `null → —`, `0 → $0.00`, and both variants rendering.

## Stage 5 — the three screens

1. **PR list.** `pulls/constants.ts`: `COLUMN_KEYS` gains `"cost"` between
   `status` and `updated`; `GRID` gains a matching track (~72px) in the same
   position — the header and the rows share this one constant, so they cannot
   drift. `PRRow.tsx` renders `<RunCostBadge variant="compact" … />`;
   `styles.ts` gets a `costCell`.
2. **Timeline.** `RunHistory.tsx`: inside the right-aligned column that holds the
   time, render the `detailed` badge for `status === 'done'`.
3. **Trace drawer.** `TraceBody.tsx`: a `<Stat>` tile for cost between TOKENS and
   FINDINGS, fed by `formatUsd(stats.cost_usd)`. `s.statsRow` is a flex row, so a
   fourth tile needs no layout change.
4. **i18n** (`client/messages/en/`): `prReview.list.columns.cost`,
   `runs.trace.stat.cost`, and `common.runCost.tokens` — which must be
   `"{count, number} tok"`, not `"{count} tok"`: a bare ICU argument prints
   `9119 tok`, only the `number` type gives the design's `9,119 tok`. The badge
   lives in `src/components/`, so its copy belongs to the `common` namespace —
   any test rendering it must pass `common` into `NextIntlClientProvider`.

**Test:** extend `RunHistory.test.tsx` (cost line shows for a done run, absent
for a failed one) and `RunTraceDrawer.test.tsx` (COST tile, and `—` for a trace
with no `cost_usd`).

## Stage 6 — verification

Commands for you to run (I will not run test suites unprompted):

```
cd server && pnpm typecheck
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd server && pnpm exec vitest run .it.test          # needs Docker
cd client && pnpm typecheck && pnpm test
```

Then manually: `./scripts/dev.sh --no-seed`, run a review against a repo with an
OpenRouter key configured, and check all three surfaces. Only new runs show a
cost — historical rows stay `—` by design.

## Risks

- **Two contract copies.** Editing only one is how they drift; the client
  compiles against its own copy and would not catch it.
- **Manual migration.** Forgetting `pnpm db:migrate` surfaces as
  `column "cost_usd" does not exist` at route level, not at boot.
- **Null vs zero.** A free model legitimately costs `$0.00`; collapsing that into
  `—` (or the reverse) is the one bug this feature can ship invisibly.
