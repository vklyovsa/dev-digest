# Smart Diff — reviewer-ordered Files changed tab (HW3)

Source: `hw3` (homework text) + designs `i/img.png`, `i/img_1.png`, `i/img_2.png`, `i/img_3.png`.
Packages: **server**, **client** (contract change lands in both `vendor/shared` copies).
Acceptance criteria: [`smart-diff-acceptance.md`](smart-diff-acceptance.md).
Open questions / decisions for the user: [`smart-diff-questions.md`](smart-diff-questions.md).

## Goal

The Files changed tab reads like a reviewer would read the PR: files are grouped by role
(core → tests → wiring → docs → boilerplate) and the agent's findings are shown inside the
diff — a counter on the group header, a dot on the file card and the finding card under the
exact line — so the reviewer never has to jump to the Agent runs tab.

## Non-goals

- No model call anywhere in Smart Diff: grouping is a pure path classifier, findings are
  read from the DB. `pseudocode_summary` stays unset; `split_suggestion` is minimal
  (`too_big: false`, `total_lines = Σ additions + deletions`, `proposed_splits: []`).
- No DB migration, no seed change. The Agent runs tab stays as it is.
- No new diff parser: `parsePatch`, `keysForLine`, `partitionThreads` are reused.

## Behaviour

### Server

- Pure `classifyFile(path): SmartDiffRole` in its own module `server/src/modules/smart-diff/`
  (importable without HTTP — L08 reuses it as a prompt filter). Patterns and the role order
  live in ONE `constants.ts`. First matching rule wins, checked in this order:
  1. **boilerplate** — `*.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `dist/**`,
    `build/**`, `**/__snapshots__/**`, `*.snap`, `*.generated.*`, `*.min.js`
  2. **tests** — `**/*.test.ts(x)`, `**/*.it.test.ts`, `**/*.spec.ts`, `**/test/**`,
    `**/tests/**`, `**/__tests__/**`, `e2e/**`
  3. **wiring** — barrel `index.ts` / `index.js`, `*.config.*`, `tsconfig*.json`, `.eslintrc*`,
    `.env*`, `docker-compose*.yml`, `.github/**`, `.claude/**`
  4. **docs** — `**/*.md`, `docs/**`, `README*`, `CHANGELOG*`, `LICENSE`
  5. **core** — everything else
- Display order of groups is fixed: core, tests, wiring, docs, boilerplate. Empty roles are
  omitted from `groups[]`.
- `SmartDiffRole` becomes `['core','tests','wiring','docs','boilerplate']` in BOTH
  `server/src/vendor/shared/contracts/brief.ts` and `client/src/vendor/shared/contracts/brief.ts`
  (files stay byte-identical).
- `GET /pulls/:id/smart-diff` (workspace-scoped like `GET /pulls/:id`): reads the PR's stored
  files (`pr_files`) and the findings of the **newest review per agent** for that PR
  (`server/INSIGHTS.md`: findings are never deduplicated between runs; an agent supersedes
  itself, never its colleagues). Per file: `path`, `additions`, `deletions`,
  `finding_lines` = sorted unique `start_line` of that file's findings. Returns a body that
  parses with `SmartDiff`. Works before the first review (all `finding_lines` empty).

### Client (Files changed tab)

- Header "REVIEWER-ORDERED DIFF", summary `N files · +A −D`, segmented control
  **Smart order | Original order** (Smart is the default).
- Smart order: one section per group from `GET /pulls/:id/smart-diff` — chevron, colour
  square, role label, role description, and on the right `● K` (number of FILES in the group
  with findings, hidden when 0) then `N files`. Header is sticky while scrolling.
  docs and boilerplate start collapsed; core/tests/wiring start expanded; file cards inside
  keep the existing `AUTO_EXPAND_MAX_LINES` rule. Patches are joined from `pr.files` by path.
- Original order: the flat `pr.files` list in GitHub order, same file cards (dots and inline
  findings still visible).
- File card: a red dot next to the path when the file has findings (no number) — separate
  from the existing GitHub comment counter.
- Line: the finding's `start_line` (key `RIGHT:<start_line>`) gets a coloured left bar and a
  right-aligned label with the severity icon: CRITICAL → `blocker`, WARNING → `warning`,
  SUGGESTION → `suggestion` (colour/icon from `SEV`). Under that line the finding card:
  severity, title, rationale, suggestion, Accept / Dismiss — the Agent runs `FindingCard`
  reused, rendered expanded; clicking its header collapses it to one line.
- Findings whose line is not in the patch are listed in a block at the end of the file card.
- The existing Show/Hide comments toggle also hides/shows finding cards; it is visible when
  there are GitHub comments OR findings, and starts in the "shown" state so findings are
  visible on first open. Dots and group counters stay visible when cards are hidden.
- Accept / Dismiss use `useFindingAction()` and update the card state in place.
- Before any review: an inline hint "No review has run yet — run one to see findings in the
  diff" instead of zero counters.
- After a run finishes, the counters, dots and cards update without a page reload
  (smart-diff and reviews queries are invalidated/refetched).
- All strings from `client/messages/en/prReview.json` → `smartDiff` (add `testsLabel`,
  `docsLabel`, descriptions, order toggle, empty state, severity line labels).

## Affected files (expected)

- server: `src/modules/smart-diff/*` (new), `src/modules/index.ts`, `src/vendor/shared/contracts/brief.ts`,
  tests under `server/test/` (classifier table unit test, route `*.it.test.ts`).
- client: `src/vendor/shared/contracts/brief.ts`, `src/lib/hooks/*` (smart-diff query),
  `DiffTab` and its children, `src/components/diff-viewer/*` (finding slot on FileCard /
  CodeLine), `messages/en/prReview.json`, tests beside the code.
