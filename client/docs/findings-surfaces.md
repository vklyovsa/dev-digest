# Findings surfaces — where a finding is rendered, and from which data

A finding shows up on four screens. They look related on purpose, but they read
from three different sources, which is what decides where a new detail belongs.

| Surface | Component | Data source | Scope | Interactive? |
|---|---|---|---|---|
| PR list, FINDINGS column | `components/findings-summary/` in `_components/PRRow` | `PrMeta.findings` from `GET /repos/:id/pulls`, summarized server-side | summed across agents, each agent's **latest** run only, dismissed excluded | hover popover «N FINDINGS IN THIS RUN», read-only |
| PR timeline tile | `_components/RunHistory` | `usePrReviews` findings, keyed `run_id` → findings in `FindingsTab` | that **run's own** findings, including dismissed | the same popover header, read-only |
| Review run card | `_components/FindingsPanel` + `FindingCard` | `usePrReviews`, that run's own `findings` | that run, after the confidence gate | severity filter, accept/dismiss |
| Trace drawer | `RunTraceDrawer/_components/FindingsSection` | the findings passed in from the PR page | that run | read-only |

The scope column is the part to keep in mind: **the list is about the PR's
current state, the PR page is about what each run produced.** So the list total
is routinely lower than the sum of the timeline tiles — a superseded run and a
dismissed finding both stay visible on the page and drop out of the list. That
is intended, not drift.

## Why the list needs its own server field

The list renders up to ~30 PRs. Fetching each PR's reviews would be one request
per row, so the summary (`total`, `counts`, capped `previews`) is computed in
`GET /repos/:id/pulls` — one extra `IN` query for the whole page. The PR page
already holds every finding of every run, so its two surfaces group them in the
browser and cost nothing.

The same field feeds the SCORE ring beside it: the server derives the score from
those findings (`../../server/docs/pr-list-read-model.md`), so a row cannot show
41 next to zero findings.

## Why the counters are not a shared "findings count" prop

`RunSummary.findings_count` and `blockers` are denormalized onto the run row at
completion and drive the run's outcome badge. They cannot answer "how many
warnings", so the severity counters never read them: they group the actual
findings. When a timeline tile has no findings loaded, it shows no counters
rather than a count that disagrees with the badge next to it — which is why the
tile no longer prints "N finding(s) · M blockers" at all.

The collapsed review-run card is the one place that still shows that sentence:
its pills only exist once the card is expanded, so the header needs a summary
that works while closed.

## The rule that keeps the pills honest

In a review run card the pills are counted from the confidence-gated list — the
same list the filter narrows. So the number on a pill always equals the number
of cards a click on it leaves behind, and flipping "Hide low confidence"
re-counts the pills too. Counting the raw `findings` array instead would show
"3 SUGGESTION" above a single card, which is the bug this ordering prevents.
