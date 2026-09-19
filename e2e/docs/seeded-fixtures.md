# What the seeded fixture actually contains

Every flow asserts against `server/src/db/seed.ts`, so what the seed creates is
the contract the flows are written to. Verified against a seeded database, not
inferred from the UI.

- One repo, `acme/payments-api`, and it must be the **only** repo: flows 02, 04
  and 05 follow the home redirect to the *first* repo.
- One pull request, **#482** "Add rate limiting to public API endpoints", with
  files, commits and a body.
- One review of kind `review`: verdict `request_changes`, score 61.
- **Exactly two findings**: one `CRITICAL` ("Hardcoded Stripe secret key in
  commit", `src/config.ts:12`, confidence 0.98) and one `WARNING` ("N+1 query in
  user list endpoint", `src/api/users.ts:45-52`, confidence 0.86).
- The three built-in agents.

## Consequences for new flows

- **There is no `SUGGESTION` finding.** A flow that asserts a third severity
  pill, or a "3 severities" layout, cannot pass on seeded data — extend the seed
  first, in the same change.
- Both seeded findings are above the 0.65 confidence threshold, so
  "Hide low confidence" changes nothing on the seeded PR and is not a usable
  assertion.
- The seeded review has no `run_id`, so it shows up under "Review runs" but the
  Timeline has no run tile to hover — severity counters on the timeline need a
  real run, i.e. a model call, which flows must not make.
- Cost is absent for the same reason: the seed creates no `agent_runs`, so the
  COST column reads `—`.

Re-check this file against `seed.ts` whenever a flow starts failing on data
rather than on behaviour.
