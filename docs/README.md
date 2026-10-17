# Docs — repository

Cross-cutting deep dives: material that belongs to no single package, or that
explains **why** something is built the way it is.

## Contents

- [`agent-prompts/`](agent-prompts/) — system prompts for the built-in reviewer
  agents, plus [choosing a model](agent-prompts/choosing-a-model.md).
- [`eval-pipeline.md`](eval-pipeline.md) — regression protection for a reviewer agent and for a skill: cases,
  runs, scoring in code, the Evals tab and Eval Dashboard, operations, known limits.
- [`commit-gate.md`](commit-gate.md) — the hook that refuses a `git commit` from a Claude Code
  session until the touched packages are proven green: decision, stamp, override, limits, caught case.
- `design/` — UI prototypes and visual references.
- [`retro/`](retro/README.md) — retrospectives of multi-agent runs: what each run cost,
  where agents struggled, what was proposed (`retro/ledger/`, written only by the
  user-started `/workflow-retro`).

## Rules

- `README.md` stays the map; the long explanation belongs here.
- One topic per file, kebab-case filename, a title line stating the topic.
- Link every doc from `../AGENTS.md` under `## Read when`, together with the
  trigger that should make someone open it — an unlinked doc is an unread doc.
- Architecture diagrams live here or in `README.md`, never in `AGENTS.md` / `CLAUDE.md`.
- Package-specific material goes to that package's `docs/`, not here.

Not here: work specs (`../specs/`), lessons learned (`../INSIGHTS.md`), testing
strategy (`../TESTING.md`).
