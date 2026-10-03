# Specs — repository

Cross-cutting specs: work that spans more than one package (a course lesson that
adds a server module *and* a screen, a contract change, a new pipeline stage).
Work contained in a single package gets a spec in that package's `specs/` instead.

- Name a spec `<feature-slug>.md`. Keep it while the work is open; when it lands,
  either delete it or fold what it taught into `../docs/`.
- Suggested sections: **Goal · Non-goals · Behaviour and acceptance criteria ·
  Affected packages and files · Open questions**.
- A spec states intent, not implementation steps, and is never a changelog.
- Read the spec before the first edit, not after. If the code contradicts the spec,
  stop and resolve the contradiction — do not silently follow the code.
- Name every package the work touches: the packages are independent, and a contract
  change has to land in each copy in the same commit.

## Open specs

- [`findings-by-severity.md`](findings-by-severity.md) — severity counters and the
  findings filter (server + client).
- [`run-cost.md`](run-cost.md) / [`run-cost-plan.md`](run-cost-plan.md) — run cost on
  the PR list, the run timeline and the trace drawer.
- [`skills.md`](skills.md) — reusable skills: storage, editor, agent binding, import
  (server + client), plus
  [`skills-control-experiment.md`](skills-control-experiment.md) — the with/without
  procedure, and [`fixtures/`](fixtures/) — the archive used to demo the import.
- [`conventions-extractor.md`](conventions-extractor.md) — scan a repo for house
  conventions, verify the evidence in code, accept/reject/edit, build a
  `repo-conventions` skill (server + client).
- [`api-contract-reviewer.md`](api-contract-reviewer.md) — the second agent of
  homework 2: four contract skills (texts in
  [`fixtures/api-contract-reviewer/`](fixtures/api-contract-reviewer/)) and the
  A/B experiment.
- [`smart-diff.md`](smart-diff.md) / [`smart-diff-plan.md`](smart-diff-plan.md) — HW3 Smart
  Diff: Files changed grouped by role, agent findings inline in the diff (server + client);
  criteria in [`smart-diff-acceptance.md`](smart-diff-acceptance.md), default decisions in
  [`smart-diff-questions.md`](smart-diff-questions.md), demo PR in
  [`fixtures/smart-diff-demo/`](fixtures/smart-diff-demo/).
- [`intent-layer.md`](intent-layer.md) / [`intent-layer-plan.md`](intent-layer-plan.md) —
  L03 Intent layer: derive a PR's intent from its title, linked docs/issues or
  indirect data, cache it, and carry it into every agent's prompt as an untrusted
  block (server + reviewer-core + client).
- [`devdigest-mcp-plan.md`](devdigest-mcp-plan.md) — L04 `devdigest-mcp`: a local stdio
  MCP server (new package `mcp/`) with five tools over the existing API; the tool
  contract is Appendix A (no server or client change).

## Tooling plans (`.claude/`)

Plans for the development tooling itself, not for product features.

- [`project-subagents-plan.md`](project-subagents-plan.md) — L03 project subagents in
  `.claude/agents/` (options → plan → implement → tests → verify → review → docs) and
  their guard hooks.
- [`onion-architecture-skill.md`](onion-architecture-skill.md) — the `onion-architecture`
  skill: layering rules for `server/` and `reviewer-core/`, enforced by dependency-cruiser.
- [`pr-self-review-skill.md`](pr-self-review-skill.md) — the `pr-self-review` skill and
  the hook that blocks `gh pr create` while a confirmed CRITICAL stands.
