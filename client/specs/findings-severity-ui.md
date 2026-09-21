# findings-severity-ui — severity counters on every findings surface

Client half of `../../specs/findings-by-severity.md`. Read that first for the
product intent; this file is the UI contract.

## Goal

One reading of "how bad is this run" that is identical on all four surfaces
where findings appear, and a severity filter inside a review run card.

## Behaviour and acceptance criteria

1. **Review run card** — pills sit in the `FindingsPanel` toolbar, left of the
   existing «Hide low confidence» toggle, separated by the divider rule.
   - A pill renders only for a severity present in that run.
   - `pill count === number of finding cards below`, always. The count is taken
     from the confidence-filtered list, so turning «Hide low confidence» on
     changes the pills too.
   - A pill is a `<button>` with `aria-pressed`; click selects, click again
     clears. Keyboard `j`/`k` focus resets to the first card on every change.
2. **PR list** — FINDINGS column over the PR's open findings, summed across
   agents with only each agent's LATEST run counted (dismissed excluded),
   read-only, with the hover popover «N FINDINGS IN THIS RUN» — the wording the
   acceptance criteria fix, used unchanged even though the set can span runs.
   `—` both when the PR was never reviewed and when nothing is open; the SCORE
   beside it is derived from the same set, so 65 always has the critical that
   produced it next to it.
3. **Timeline tile** — that run's own icons + counts + the same popover header
   (there it is literally one run), read-only, and no "N finding(s) ·
   M blockers" text. The tile keeps its current click targets; the counters add
   none.
4. **Trace drawer** — unchanged; it already lists the run's findings.

## Affected files

- `src/components/findings-summary/` — new: `helpers.ts` (`countBySeverity`),
  `SeverityCounts.tsx`, `FindingsPopover.tsx`, test. Shared because three routes
  render it (the `components/run-cost/` folder is the pattern to copy).
- `src/app/repos/[repoId]/pulls/{constants,styles}.ts`, `_components/PRRow/`.
- `src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/*`,
  `.../FindingsTab/FindingsTab.tsx`, `.../RunHistory/RunHistory.tsx`.
- `messages/en/prReview.json` — every new string; none inline in JSX.

## Non-goals

No new UI primitive in `src/vendor/ui`: the popover is local to this feature
until a second feature needs one. No URL state for the filter — it is per card
and resets on reload, which is what a reviewer scanning one run expects.

## Open questions

None.
