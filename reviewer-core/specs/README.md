# Specs — reviewer-core

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

- [`severity-source-of-truth.md`](severity-source-of-truth.md) — keeping one
  severity taxonomy across the contract, the engine tables and the UI.
