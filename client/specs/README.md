# Specs — client

One file per unit of work: what we intend to build, written **before** we build it.

- Only work contained in this package. A feature that touches a second package gets
  one spec in `../specs/` instead — never a half here.
- Name a spec `<YYYY-MM-DD>-<feature-slug>.md` — the date the draft was created, then
  the feature's name. Shape, IDs and the `Status` lifecycle:
  `../specs/TEMPLATE.md` and `../specs/README.md`; the `spec-creator` agent writes from
  them. When the work lands the spec stays, as `Status: implemented`.
- Specs below without a `Spec ID` predate the template and keep their old sections;
  when one lands, delete it or fold what it taught into `../docs/`.
- A spec states intent, not implementation steps, and is never a changelog.
- Read the spec before the first edit, not after. If the code contradicts the spec,
  stop and resolve the contradiction — do not silently follow the code.
- Link a spec from `../CLAUDE.md` only while it is the active piece of work.

## Open specs

- [`findings-severity-ui.md`](findings-severity-ui.md) — severity counters on every
  findings surface, and the per-run severity filter.
- [`skills-ui.md`](skills-ui.md) — the `/skills` two-pane editor, the import drawer
  and the agent's Skills tab.
- [`2026-10-12-eval-trend-charts.md`](2026-10-12-eval-trend-charts.md) — SPEC-05: Eval trend charts — a chart of recall / precision / citation accuracy over an agent's eval runs on the Evals tab and the agent's eval view, one point per run with the prompt version and cost in its tooltip, drawn from SPEC-03's run list with no model call (client).