# The PR-list read model

`GET /repos/:id/pulls` (`src/modules/pulls/routes.ts`) returns rows that carry
three derived columns — SCORE, COST and FINDINGS — none of which is stored on
`pull_requests`. They are composed on read, and the shape of that composition is
the load-bearing part of the endpoint.

## One IN-query per derived column, then group in JS

For a page of PRs the handler issues:

1. `pull_requests` for the repo (the rows themselves),
2. `reviews` where `pr_id IN (…) AND kind='review'`, newest first — the first
   row seen per (PR, agent) is that agent's current verdict,
3. `findings` where `review_id IN (…those reviews) AND dismissed_at IS NULL` —
   grouped per PR and summarized by `findings-summary.ts`, which derives SCORE,
4. `agent_runs` where `pr_id IN (…)` — summed per PR.

Four queries for the whole page, regardless of how many PRs it holds. A per-row
query in this handler is the thing to reject in review: the list is the only
screen where N is unbounded.

## What each column actually means

- FINDINGS is **every open finding in each agent's newest review**, with
  dismissed ones excluded. The two simpler queries are both wrong here: findings
  are never deduplicated between runs (`reviews/repository/review.repo.ts`
  inserts a fresh row per run and `findings` has no unique key), so counting all
  reviews shows one problem three times after two re-runs; and counting only the
  newest review keeps whichever agent finished last, hiding the rest of a
  "Run all agents" batch. The middle ground is the PR's current state: an agent
  supersedes itself, never its colleagues.
- SCORE is **derived from that same set** through `scoreFromFindings` in
  `@devdigest/reviewer-core`, not read off a review row. A multi-agent review
  writes one review per agent, so "the latest score" is whichever agent finished
  last — a lottery. Deriving it also means SCORE and FINDINGS can never
  contradict each other, which is the property the list is read for.
- COST is the **lifetime total** of every run: a PR reviewed three times really
  did cost three times as much. FINDINGS deliberately mirrors that "sum across
  agents" shape and departs from it in exactly one way — a re-run of the same
  agent replaces its earlier pass instead of adding to it, because money spent
  twice is still spent, while a problem reported twice is still one problem.

The rules are written in `specs/pr-list-findings-summary.md` and
`../specs/run-cost.md`; this file exists so none of it reads as a bug.

## Absent, not zero

A PR with no review reports `findings: null` and `score: null`; a PR whose runs
are all unpriced reports `cost_usd: null`. The UI renders `—`. A `0` would claim
a fact the data does not support — and `summarizeFindings` extends the rule to
severities: a severity that is absent is missing from `counts`, never present
with `0`.

The one case that is NOT absent: a PR that was reviewed and has nothing open
returns `score: 100` and `{ total: 0, counts: [], previews: [] }`. "Clean" is a
fact; "never reviewed" is the absence of one, and the two must not render alike
in SCORE.
