# Retro: <name>

Date: <YYYY-MM-DD>
Run: <command or pipeline> · spec `<path>` · plan `<path>` · branch `<name>` @ `<short sha>`
Mode: in-context
Totals: agents <n> · launches <n> · resumes <n> · fix rounds <n> · question rounds <n> · human prompts <n> · wall <h:mm>
Tokens: n/a (deep)
Units: stages <n> · criteria <n>/<n> · files changed <n>
Outcome: <outcome>

<!--
The nine lines above are read by `scripts/ledger.mjs`: keep the keys, the ` · ` separators
and the order. A value that is not known is `n/a`, never a guess.
  Mode    in-context | deep
  Tokens  deep:        cache read 80.5M · cache write 4.8M · output 1.1M · cost snapshot $52.56
          in-context:  n/a (deep)
  Units   stages of the plan · criteria done/total from plan-verifier · files the run changed
  wall    first agent start to last agent end, h:mm
Delete this comment in the entry.
-->

## Launch table

| # | Agent | Purpose | Trigger | Shape | ∥ with | Final context | Tool uses | Duration | Outcome |
|---|---|---|---|---|---|---|---|---|---|
| 1 | <agent> | <purpose> | <trigger> | fg | — | <n> | <n> | <m:ss> | <outcome> |

## Measurements

n/a — run with `deep`

<!--
deep: the script's tables "Where the time went", "By agent type" and "By model" as printed,
then only those rows of the other tables that a finding cites.
-->

## Findings

### <module>

- F1 [<module>] <kind> — The claim, one sentence. Evidence: agent #<n> report § Deviations, a number, a user message. Cost: tokens, rounds, minutes, or n/a.

## Proposals

First to take: P1 — why this one.

- P1 → `<target file>` — The change, concrete enough to apply. From: F1 · Effect: what moves · Effort: S · Status: proposed

## Earlier proposals

none — this is the first entry

<!-- otherwise one line per proposal of the last three entries:
- <entry file> P<n> — not applied | applied — the problem did not recur | applied — it recurred (F<n>) | recurring ×<N>
-->

## For engineering-insights

none

## Not established

none
