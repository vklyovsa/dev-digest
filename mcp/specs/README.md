# Specs — mcp

One file per unit of work: what we intend to build, written **before** we build it.

- Only work contained in this package. A feature that touches a second package gets
  one spec in `../specs/` instead — never a half here.
- Name a spec `<YYYY-MM-DD>-<feature-slug>.md` — the date the draft was created, then
  the feature's name. Shape, IDs and the `Status` lifecycle:
  `../specs/TEMPLATE.md` and `../specs/README.md`; the `spec-creator` agent writes from
  them. When the work lands the spec stays, as `Status: implemented`.
- A spec states intent, not implementation steps, and is never a changelog.
- Read the spec before the first edit, not after. If the code contradicts the spec,
  stop and resolve the contradiction — do not silently follow the code.
- The tool contract (names, descriptions, arguments, errors) is
  `../specs/devdigest-mcp-plan.md` Appendix A. A spec here states what a tool must do;
  the contract text changes there first.

## Open specs

- [`2026-10-17-server-version-from-package-json.md`](2026-10-17-server-version-from-package-json.md) — SPEC-11: the MCP server reports `serverInfo.version` from `mcp/package.json` instead of a hard-coded `0.0.0`, one place to bump (mcp).
- [`2026-10-17-server-build-info.md`](2026-10-17-server-build-info.md) — SPEC-12: MCP server build info — the SPEC-11 version-from-package.json requirements plus a build identity an operator can read; relation to SPEC-11 and what a build is are open (mcp).
