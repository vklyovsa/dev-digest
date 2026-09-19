# Severity — one enum, four derived tables

`Severity` (`@devdigest/shared`, `contracts/findings.ts`) has three values:
`CRITICAL`, `WARNING`, `SUGGESTION`. The engine owns everything derived from
them, and each table is keyed by that enum:

| Table | File | What it decides |
|---|---|---|
| `SEVERITY_PENALTY` | `src/review/reduce.ts` | the deterministic 0–100 score: 100 − Σ penalties (critical 35, warning 12, suggestion 3) |
| `SEV_RANK` | `src/output/to-review.ts` | severity ordering for gate comparisons (suggestion 1 → critical 3) |
| `FAIL_ON_MIN_RANK` | `src/output/to-review.ts` | which rank trips a given `ci_fail_on` policy; `never` is `Infinity` |
| `SEV_EMOJI` / `severityCounts` | `src/output/to-review.ts` | the CI comment's "N critical · N warning · N suggestion" line |

## Why the model's own numbers are ignored

`scoreFromFindings` and `gateTriggered` recompute the score and the review event
from the surviving findings, so the number on screen can never contradict the
findings under it. A model's self-reported `score` and `verdict` drift between
models; severity is the only signal the pipeline trusts.

## Who else reads these tables

- `severityCounts` rolls findings up into a string for the CI comment.
- The studio groups severities itself — in the browser for the severity pills,
  and in `server/src/modules/pulls/findings-summary.ts` for the PR list. That
  duplication is deliberate: the engine formats text for GitHub, the UI needs
  per-severity numbers it can filter on.
- `scoreFromFindings` is **not** duplicated. The server's PR list calls it
  directly (via the `src/index.ts` export) to score a PR from its open
  findings, so a row's SCORE and its severity counts come from one table. It
  takes `Pick<Finding, 'severity'>[]` for exactly that caller.

## Adding a severity

Contract first, then all four tables above in the same change. Both `SEV_RANK`
and `SEVERITY_PENALTY` are read with `?? 0`, so a value missing from either is
silently free: it scores nothing and trips no gate. See
`../specs/severity-source-of-truth.md` for the `INFO` value that exists in the
client design tokens and nowhere else.
