# findings-severity-filter — severity pills narrow a run's findings

Written spec for a flow that does not exist yet. Inert to the runner (only
`*.flow.json` is loaded). See `../../specs/findings-by-severity.md` for intent.

## Journey

On PR #482's Agent runs tab, the open review run shows severity pills; clicking
one leaves only that severity's finding cards, clicking it again restores both.

## Preconditions (seeded state)

`pnpm db:seed` gives `acme/payments-api` PR #482 one review run with exactly two
findings: `CRITICAL` "Hardcoded Stripe secret key in commit" and one `WARNING`.
**There is no seeded `SUGGESTION` finding** — a flow must not assert a third
pill, and `e2e/docs/seeded-fixtures.md` is the place that records this.

## Steps

1. Reuse steps 1–7 of `04-pr-findings.flow.json` to land on `?tab=findings`
   with the newest run's accordion open.
2. `wait --text "1 CRITICAL"` — the pill row rendered.
3. `find text "1 WARNING" click` — filter to warnings.
4. `wait --text` the warning finding's title; the critical title must be gone
   (needs a negative assertion the runner does not have today — see below).
5. `find text "1 WARNING" click` again → both titles visible.

## What proves it passed

Step 4 is the whole point, and it needs "text is absent", which the current step
schema (`wait --text` / `stdoutIncludes`) cannot express. Options, in order of
preference: add an `absent` assertion to the runner, or assert on a count
rendered only while filtered. Until one exists, the filter stays covered by the
`FindingsPanel` component test and this flow is not written — a flow that can
only prove the happy half is a false green.
