# Findings by severity — counters and filter

## Goal

Make the severity mix readable at a glance, and let a reviewer read one
severity at a time: a row of pills «N CRITICAL · N WARNING · N SUGGESTION» in
an expanded review run, where clicking a pill narrows the findings below it; the
same counts, read-only, on the PR list and on every timeline tile; and a list
SCORE derived from those very findings. Nothing here calls a model — the numbers
are a `COUNT` over findings that are already persisted.

## Non-goals

- No new severity levels, no re-grading, no model call of any kind.
- No cross-PR rollup and no server-side filtering: the filter is view state.
- No change to Accept / Dismiss, to the CI gate, or to how `blockers` is
  computed (`reviewer-core/src/output/to-review.ts`).

## Behaviour and acceptance criteria

**Review run card** (PR → Agent runs → Review runs → expand)

- Under the verdict banner: one pill per severity **present in that run**, as
  `N CRITICAL`, in the run's own findings.
- The number on a pill equals the number of finding cards rendered below it —
  so it is computed *after* «Hide low confidence», never before.
- Clicking a pill leaves only that severity below; clicking it again restores
  the full list of that run. Filtering is per run card, not per page.

**PR list** (`/repos/:id/pulls`)

- A FINDINGS column between SCORE and STATUS shows severity icon + count
  aggregated **like COST — summed across agents — except that each agent
  contributes only its LATEST run.** Example: Test Quality ran once and found 3,
  General ran three times and its last pass found 4 → the row reads **7**, not
  the sum of every pass and not just the 4 of whoever ran last.
- Neither of the two obvious readings works: *all reviews* double-counts a
  re-run (findings are never deduplicated between runs), and *the single newest
  review* keeps only the agent that happened to finish last.
- **Dismissed findings are excluded.** Pressing Dismiss says "not a problem",
  so it must stop counting here and stop costing score.
- Hovering shows a read-only popover titled **«N FINDINGS IN THIS RUN»** —
  verbatim from the acceptance criteria, on the list as well as on a timeline
  tile. On the list the set spans each agent's latest run, so the heading is a
  fixed label rather than a literal description; the wording is required and
  stays as written. The card itself shows severity icon, title, category,
  `file:line`, confidence and a short rationale. No buttons — actions live on
  the PR page.
- **SCORE is derived from that same set** via `scoreFromFindings` in
  `@devdigest/reviewer-core` (100 − 35/critical − 12/warning − 3/suggestion),
  not from a review row: a multi-agent review writes one review per agent, so
  "the latest score" is whichever agent finished last. Derived means the two
  columns can never contradict each other.
- Never reviewed → both cells empty (`—`). Reviewed with nothing open → score
  100 and an empty FINDINGS cell; a zero is never printed.

**Timeline** (PR → Agent runs → Timeline)

- Each run tile carries that run's own severity icons + counts, read-only, with
  the popover titled «N FINDINGS» on hover. The old "N finding(s) · M blockers"
  sentence is gone — icons with numbers only; the outcome badge already says how
  serious the run was.
- Not clickable — the tile's existing click targets (agent name → review card,
  trace, delete) stay as they are.

## Affected packages and files

- **server** — `src/vendor/shared/contracts/{findings,platform}.ts` (new
  `FindingPreview` / `FindingsSummary`, `PrMeta.findings`),
  `src/modules/pulls/routes.ts` (one extra IN-query), `test/pulls-findings.it.test.ts`.
- **client** — `src/vendor/shared/contracts/{findings,platform}.ts` (the second
  copy of the contract), `src/components/findings-summary/` (new),
  `src/app/repos/[repoId]/pulls/` (list column) and
  `.../pulls/[number]/_components/{FindingsPanel,FindingsTab,RunHistory}/`,
  `messages/en/prReview.json`.
- **reviewer-core** — `scoreFromFindings` widened to take `Pick<Finding,
  'severity'>[]` and exported from `src/index.ts`, so the server can score a
  projection of findings. The engine stays the source of truth for what a
  severity *means* and what it *weighs* (`specs/severity-source-of-truth.md`,
  `docs/severity.md`).
- **e2e** — `specs/findings-severity-filter.spec.md` (written spec only; the
  seeded fixture has no SUGGESTION finding to assert on).

## Open questions

None. Decisions taken: the list aggregates **every open finding of the PR** and
derives SCORE from it, COST stays a lifetime total, the popover is read-only,
and pills only render for severities that are actually present. The collapsed
review-run card keeps its "N findings · M blockers" line — it is the summary of
a card whose pills are not visible yet.
