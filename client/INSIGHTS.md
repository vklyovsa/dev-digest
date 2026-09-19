# Insights — client

Learnings for `@devdigest/web`: App Router behaviour, data hooks, the vendored UI
kit, i18n, and component testing.

**Fixed sections — append to the matching one, never to the bottom of the file.**
If an entry fits nowhere here, it probably belongs in `docs/` or nowhere at all.

How to write one: 1–3 lines, newest first inside its section, recording what a
careful reader could not have predicted from the code. Not a task log, not a
changelog, not a restatement of the diff. When an entry has bitten a third time,
promote it to `CLAUDE.md` — § Conventions for a pattern, § Gotchas for a trap —
and leave it here as history.

## What Works

Approaches and solutions that held up, with the context that made them work.

_None yet._

## What Doesn't Work

Dead ends and anti-patterns: what was tried, why it failed, what to do instead.
**The highest-value section and the one most often left empty. Fill it.**

- **An absolutely-positioned hover card inside the PR list gets clipped: the table card is `overflow: hidden`.** (2026-09-17) `src/app/repos/[repoId]/pulls/styles.ts:88` sets it on `tableCard`, so a card anchored in a row is cut at the table edge — worst on the last rows, where it is invisible rather than merely trimmed.
  → Position hover cards `fixed` off the trigger's `getBoundingClientRect()` and flip above when there is no room below, as `src/components/findings-summary/FindingsPopover.tsx:24` does.

## Codebase Patterns

Conventions and architectural decisions found while working here, before they are
settled enough to move into `CLAUDE.md`.

_None yet._

## Tool & Library Notes

Quirks of dependencies, versions and tooling — what a library does that its docs
do not say.

- **`MonoLink` renders a `<button>` when it is given no `href`.** (2026-09-17) `src/vendor/ui/primitives/MonoLink.tsx:42` returns a focusable `<button>`; the `<a>` is emitted only on the href branch, so reusing the primitive on a read-only surface silently adds a control and a tab stop where the design says there is none.
  → On a read-only surface render `file:line` as a plain `<span className="mono">`; keep `MonoLink` for references that really navigate.

- **A bare ICU argument does not group digits: `{count} tok` renders `9119 tok`.** next-intl passes values to intl-messageformat (10.7.18), where only a typed argument gets `Intl.NumberFormat` — `{count, number} tok` is what produces `9,119 tok`. Verified directly against the bundled formatter, not inferred from the docs.
  → Type every message argument that can exceed 999 as `{x, number}`; a plain `{x}` silently ships ungrouped digits that no type or lint check will catch.

- **Grepping rendered Next.js HTML for `This page could not be found` gives false
  positives.** The string ships inside the RSC flight payload (`<script>self.__next_f…`)
  on pages that render fine, so a plain `curl | grep` reports a 404 that is not there.
  → Check the HTTP status first, and strip `<script>`/`<style>` before matching text.

## Recurring Errors & Fixes

Error or symptom → cause → fix, one entry each, so the next occurrence is a lookup
instead of an investigation.

- **`Unable to find an element with the text: $0.0013` while the badge visibly renders it.** (2026-09-17) `RunCostBadge` variant `detailed` emits the token count and the cost as two text nodes of ONE span (`src/components/run-cost/RunCostBadge.tsx:47`), and Testing Library matches text per element, not per node — two cost assertions in `RunHistory.test.tsx` were red from the day they were written.
  → Assert the joined text (`getByText("150 tok · $0.0013")`) or pass a regex; never an exact string for half of a multi-node element.

## Session Notes

Dated summaries as `### YYYY-MM-DD — topic`: what was worked on and what state it
was left in. Prune an entry once its content has moved into a section above.

_None yet._

## Open Questions

Unresolved behaviour, undecided design, unverified assumptions. Delete an entry when
it is answered — the answer belongs in another section.

- **Unverified: whether a shared `src/components/*` component forces every test that renders it to register the `common` namespace.** `RunCostBadge` takes its copy from `common`, while `RunHistory.test.tsx` passed only `{ prReview }` to `NextIntlClientProvider`; `common` was added preemptively and no test run has shown whether next-intl throws there or quietly renders the key path.
  → Settle it on the next `client` test run; if it throws, this is a rule for every shared component and belongs in Codebase Patterns.
