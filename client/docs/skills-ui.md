# The Skills screen

`/skills` is a two-pane editor for text that ends up in an agent's prompt. This
file records the decisions that are not obvious from the components.

## One address per skill, list kept in the layout

**Corrected 2026-09-24.** The list used to live in `/skills?skill=<id>`, and a
detail-only `/skills/[id]` page was added beside it. That split failed the
grading criteria both ways: clicking a card never produced `/skills/:id`, and
the detail page had no list beside it. Both are now one route family.

- `/skills` and `/skills/[id]` share `app/skills/layout.tsx`, which renders
  `SkillsShell`: the list on the left, the active page on the right. A layout
  survives navigation between its child routes, so moving from one skill to the
  next keeps the list mounted — search text and scroll position included. That
  was the only reason selection had ever lived in the query string.
- `/skills` shows "Select a skill"; `/skills/[id]?tab=<config|context|preview|evals|stats|versions>`
  shows `SkillDetail` in the right pane. Clicking a card PUSHES `/skills/:id`
  (one history entry per skill); switching tabs REPLACES it.
- The pane reads the skill out of the same cached `useSkills()` list the left
  side renders, so a toggle or rename shows on both sides with no extra request.
  An unknown id — deleted in another tab, or a stale link — gets the
  "Skill not found" empty state, not an empty pane.
- Old `/skills?skill=<id>&tab=…` links are forwarded to `/skills/<id>?tab=…` by
  `SkillsIndex`, so bookmarks and PR descriptions keep working.

## What the tabs are, and what they are not

| Tab | Source of every number on it |
|---|---|
| Config | the row itself |
| Context | the project-context documents attached to the skill |
| Preview | `skill.body`, rendered — nothing re-fetched |
| Evals | stored `eval_cases` and `eval_runs` of the skill (`GET` only on open) |
| Stats | `agent_skills` (used-by) + `ceil(chars/4)` (prompt size) |
| Versions | `skill_versions` |

The design also sketches three metrics — pull frequency, accept rate, findings
per skill. They are not implemented, and that is a decision rather than a gap:
nothing records which skill produced which finding, so those numbers could only
be invented. A tab that lies is worse than a tab that is missing. If per-skill
attribution ever lands (a `finding.skill_id`), Stats is where it goes.

The **Evals** tab (`_components/SkillDetail/_components/EvalsTab/`) shows no
invented number either: it lists the skill's own cases and the scores of its
stored runs. A skill has no model or prompt, so every run goes through a **host
agent** picked on the tab (linked agents first; the host of the newest run is
preselected) with only this skill's saved body as the skill block. A disabled
skill can be evaluated, and the tab says so. The same tiles, run history and
compare view as the agent's Evals tab are reused; the compare view diffs the two
skill bodies and has no Promote — the Versions tab already restores a body. No
trend chart. With no agent in the workspace, cases can be created but run
controls are disabled with a hint. Deleting a skill deletes its cases and runs;
the confirm dialog says so. The case list is shared with the agent tab
(`src/components/eval-case-list/`). Mechanics, routes and limits:
[`docs/eval-pipeline.md`](../../docs/eval-pipeline.md) § Skill evals.

## The description field is the interface

`config.descriptionHint` says it out loud: write it as a directive ("Detects…",
"Flags…", "Requires…"). It is the field people fill in last, and it is the field
that decides whether anyone ever attaches the skill. The same hint appears in
the create modal, because that is where the habit is set.

## Token estimates

`approxTokens` (`src/lib/tokens.ts`) is `ceil(chars / 4)` — deliberately the
same heuristic the server falls back to when tiktoken is unavailable. It is
shown in three places: the body editor header, the import preview, and every
prompt block in the run-trace drawer. Always prefixed with `≈`, because it is an
estimate and nobody is billed on it.

Showing it on the trace's prompt blocks is what makes "skills cost tokens"
visible: the Skills block sits next to the diff block with both numbers on
screen.

## Import is two steps on purpose

`AddSkillDrawer` never writes on the first action. Picking a file (or a catalog
entry) calls `POST /skills/import/preview`, which parses and returns; only the
confirm button calls `POST /skills/import`. The preview lists what was read and
what was left behind, executables included — an archive can carry `scripts/`,
and the product's answer is to name them and refuse them.

An imported skill arrives **disabled**. The server enforces that regardless of
what the client sends, so a bug in this drawer cannot enable somebody else's
instructions by accident.

## Two constraints that are not visible in the code

**The vendored contracts are type-only here.** `client/src/vendor/shared` is
re-exported with `.js` specifiers over `.ts` sources: `tsc` and vitest resolve
that, Next's bundler does not. Import only `type`s from `@devdigest/shared` in
this package; when a zod enum's values are needed, write the tuple locally and
guard it with an `Exclude<...>` check (`app/skills/constants.ts`).

**jsdom has no `Blob.prototype.arrayBuffer`.** Anything that reads a picked
file fails there with a TypeError the component swallows into a generic error.
`src/test/setup.ts` polyfills it through `FileReader`.

## Ordering in the agent's Skills tab

Rows are draggable and also carry ↑ / ↓ buttons. The buttons are not a
fallback UI — they are the keyboard-reachable path, and the one a jsdom test can
exercise (HTML5 drag events do not fire meaningfully there). Linked skills are
rendered first and contiguously: "move up" over an unlinked row would be
meaningless, since only linked rows have a position.

Every change persists immediately with the full ordered array (`skill_ids`);
attach, detach and reorder are one call, because they are one concept — the
array IS the order of the blocks in the prompt.

That full-replace semantics is also why the rows do not render until
`useAgentSkills` has answered: acting on a list that is empty only because it
has not loaded would send a one-element array and unlink everything else. The
local state is an optimistic override of the query, never a copy of it — a copy
synced by an effect is how the stale order got written back.
