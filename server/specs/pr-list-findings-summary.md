# pr-list-findings-summary — severity breakdown on the PR list

Server half of `../../specs/findings-by-severity.md`.

## Goal

`GET /repos/:id/pulls` returns, per PR, the severity breakdown and a few
read-only previews of every **open finding of the PR**, plus a SCORE derived
from that same set — so the list can render the FINDINGS and SCORE columns and
a hover popover without a second request.

## Behaviour and acceptance criteria

- New field on `PrMeta`: `findings: FindingsSummary | null` —
  `{ total, counts: [{severity, count}], previews: [] }`, worst severity first.
  List endpoint only, like `score` and `cost_usd`.
- Source is the **newest `reviews` row per (pr_id, agent_id)** with
  `kind='review'`, and its `findings` **excluding** rows with a `dismissed_at`.
  Same aggregation shape as COST — summed across agents — with one correction:
  an agent's re-run supersedes its own earlier pass, because findings are never
  deduplicated between runs (so "all reviews" counts one problem twice), while
  every other agent keeps contributing (the single newest review would drop
  them). Worked example: 3 findings from a one-pass agent + 4 from the last of
  another agent's three passes = 7. A review with no `agent_id` keys on itself
  and stands alone.
- `score` is `scoreFromFindings` (`@devdigest/reviewer-core`) over that same
  set — never a review row's own score, which is per-agent and therefore a
  lottery when several agents ran. The engine's penalty table stays the only
  definition of severity weight; do not re-implement it here.
- `null` (both fields) when the PR has no review at all. A reviewed PR with
  nothing open returns `score: 100` and `{ total: 0, counts: [], previews: [] }`
  — "clean" is not "un-reviewed". A severity that is absent never appears with
  a `0`.
- `previews` is capped at 5, ordered CRITICAL → WARNING → SUGGESTION and then
  by confidence descending, and carries only what the popover renders:
  `id, severity, category, title, file, start_line, end_line, confidence,
  rationale`.
- Cost of the read: **one** extra `IN` query for the whole list, grouped in JS —
  never a query per row. No model call.

## Affected files

- `src/vendor/shared/contracts/findings.ts` — `FindingPreview`,
  `FindingsSummary` (and the client's copy of the same file, in the same commit).
- `src/vendor/shared/contracts/platform.ts` — `PrMeta.findings`.
- `src/modules/pulls/routes.ts` — next to the existing `costByPr` block.
- `src/modules/pulls/findings-summary.ts` — `summarizeFindings` (group-by) and
  `scoreForFindings` (delegates to the engine).
- `test/pulls-findings.it.test.ts` — DB-backed, so the `*.it.test.ts` suffix is
  mandatory. Cases: no review → `null`; every agent contributes; a re-run
  supersedes the same agent's earlier pass; an agent whose latest pass is clean
  drops out; dismissed excluded; score derived, not read off a review row;
  reviewed-and-clean → 100; previews capped and ordered. Plus the hermetic
  `test/pulls-findings-summary.test.ts`.

## Open questions

None. Dismissed findings are excluded here while the PR page still renders them
muted — the list is about what is open, the page about what a run produced. That
difference is documented in `../docs/pr-list-read-model.md`.
