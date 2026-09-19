# severity-source-of-truth — one taxonomy, three consumers

Opened while building the severity counters (`../../specs/findings-by-severity.md`).
The engine is not modified by that work; this spec exists because the work
surfaced a split the engine owns.

## Goal

Keep exactly one severity taxonomy. `Severity` in the contract
(`@devdigest/shared`, `contracts/findings.ts`) is it: `CRITICAL | WARNING |
SUGGESTION`. Everything that ranks, scores, gates or counts findings derives
from that enum and from the engine's tables, never from its own list.

## The split to close

- Contract and engine agree on three values. The engine's three derived tables
  are `SEVERITY_PENALTY` (`src/review/reduce.ts`), `SEV_RANK` +
  `FAIL_ON_MIN_RANK` (`src/output/to-review.ts`) and the CI-comment roll-up
  `severityCounts` (same file).
- The client design system declares a **fourth** value, `INFO`
  (`client/src/vendor/ui/primitives/tokens.ts`), and two client constant maps
  carry an `INFO` entry. Nothing in the engine, the API or the DB can produce
  it, so those branches are unreachable today.

## Acceptance criteria

- A new severity is added to `contracts/findings.ts` first, then to every
  engine table above in the same change — a missing penalty silently scores 0
  and a missing rank silently never trips the gate (both use `?? 0`).
- The UI derives its severity list from the contract, not from design tokens.
- `INFO` is either promoted to the contract (with a penalty and a rank) or
  dropped from the design system. Until then, treat it as dead.

## Non-goals

No re-grading of existing findings, no per-agent severity policy, no change to
`ci_fail_on`.

## Open questions

Which way `INFO` should go. It reads like a leftover from the UI prototype
rather than a planned level, but nothing in the repo records the intent.
