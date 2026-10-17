# Specs — repository

**Only specs that touch two or more packages live here** — a course lesson that adds a
server module *and* a screen, a contract change, a new pipeline stage — together with
the plans and fixtures that belong to them. Work contained in a single package gets its
spec in that package's `specs/` instead (`server/`, `client/`, `reviewer-core/`, `mcp/`).
`e2e/specs/` holds flows and journey specs in a format of its own.

- One file per feature, `<YYYY-MM-DD>-<feature-slug>.md` — the date the draft was
  created, then the feature's name, so specs are told apart at a glance — in one place:
  here or in one package, never a root spec plus package halves.
- Shape: [`TEMPLATE.md`](TEMPLATE.md) — the header (`Spec ID`, `Status`, `Supersedes`),
  twelve sections, acceptance criteria in EARS. The `spec-creator` agent
  (`../.claude/agents/spec-creator.md`) writes specs from it: it asks its blocking
  questions first, then writes a `draft` and returns the rest. What is still unanswered is
  marked `[NEEDS CLARIFICATION: … → OQ-n]` in the text, never filled in.
- `Status` goes `draft` → `approved` → `implemented`. `approved` is set only after the
  user says so, with no `[blocking]` question open and with
  `.claude/agents/scripts/check-spec.sh --for-approval` passing; `implementation-planner`
  does not plan a `draft`. An approved spec is not edited to change a decision — a new spec with
  `Supersedes:` replaces it. When the work lands the spec stays, as `implemented`.
- A spec states intent and is never a changelog. It may carry workflow and communication
  diagrams and the contracts between the sides, and usually no implementation detail
  ([`TEMPLATE.md`](TEMPLATE.md) § What belongs in a spec).
- The chain: `spec-creator` writes the spec, then `implementation-planner` takes the
  approved spec as its input and writes the Implementation Plan, saved beside it under
  the same name with `-plan` before `.md`.
- Read the spec before the first edit, not after. If the code contradicts the spec,
  stop and resolve the contradiction — do not silently follow the code.
- Name every package the work touches (`Packages:` under Module interactions): the
  packages are independent, and a contract change has to land in each copy in the same
  commit.
- Specs without a `Spec ID` were written before the template. They keep their sections
  (Goal · Non-goals · Behaviour and acceptance criteria · Affected packages and files ·
  Open questions), some have package halves, and they are not migrated; when such a spec
  lands, delete it or fold what it taught into `../docs/`.

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
- [`devdigest-mcp-plan.md`](devdigest-mcp-plan.md) — `devdigest-mcp`: a local stdio
  MCP server (new package `mcp/`) with five tools over the existing API; the tool
  contract is Appendix A (no server or client change).
- [`blast-radius.md`](blast-radius.md) — Blast Radius: what a PR's changed symbols reach, read
  from the repo-intel index, on the Overview tab and through `get_blast_radius`
  (server + client + mcp).
- [`2026-10-04-project-context.md`](2026-10-04-project-context.md) — SPEC-01: Project Context — find a repository's specs / docs / insights documents, attach them by hand to agents and skills, send them to the model as one untrusted block and show them in the run trace (server, client, reviewer-core).
- [`2026-10-05-pr-brief.md`](2026-10-05-pr-brief.md) / [`2026-10-05-pr-brief-plan.md`](2026-10-05-pr-brief-plan.md) — SPEC-02: PR Brief — one model call turns a pull request's computed facts (intent, blast radius, diff statistics, description, attached documents) into a summary, file-anchored risk areas and a review focus list on the Overview tab, cached per head commit, with a jump to the file on Files changed (server, client); homework criteria in [`pr-brief-acceptance.md`](pr-brief-acceptance.md).
- [`2026-10-12-eval-pipeline.md`](2026-10-12-eval-pipeline.md) — SPEC-03: Eval Pipeline — turn an accepted or dismissed finding into an eval case with one click, run an agent on its frozen case set, score recall / precision / citation accuracy in code with no model call, compare two runs with their system prompts, and an Eval Dashboard page (server, client) — superseded in part by SPEC-09 — superseded in part by SPEC-10.
- [`2026-10-12-case-editor.md`](2026-10-12-case-editor.md) — SPEC-04: Case Editor — create an eval case by hand from a pasted diff with a diff-viewer preview, an expectation type, a file and a line range, and edit any case of an agent's set without rewriting stored runs; extends SPEC-03 (server, client) — superseded in part by SPEC-09.
- [`2026-10-12-commit-test-gate.md`](2026-10-12-commit-test-gate.md) — SPEC-07: Commit test gate — a `PreToolUse` command hook that refuses a session's `git commit` until the touched packages are proven green, the test check that writes the proof, and one recorded caught case (tooling).
- [`2026-10-12-own-skill-eval.md`](2026-10-12-own-skill-eval.md) — SPEC-06: Own skill eval — a 3–4 case model-backed regression suite in `evals/skills/` for one of the user's own skills, proven by a break → red → restore → green series within a stated run budget (tooling).
- [`2026-10-13-eval-case-modal.md`](2026-10-13-eval-case-modal.md) — SPEC-09: Eval case modal — "Turn into eval case" opens a prefilled modal and stores nothing until Save; "Run case" tries the form's content as one unstored review with pass / fail and the agent's findings; plus "Run on save", a run control per case row, "Run all agents", "Promote vN" and a sparkline per dashboard row; supersedes SPEC-03, SPEC-04 and SPEC-05 in part (server, client) — superseded in part by SPEC-10.
- [`2026-10-13-skill-evals.md`](2026-10-13-skill-evals.md) — SPEC-10: Skill evals — eval cases owned by a skill and an Evals tab in the Skill Editor: the set runs through a chosen host agent with the skill as the only skill block, scored by the existing code into recall / precision / citation accuracy, with run history and a comparison of two skill bodies; supersedes NG-4 of SPEC-03 and SPEC-09 (server, client).

## Tooling plans (`.claude/`)

Plans for the development tooling itself, not for product features.

- [`project-subagents-plan.md`](project-subagents-plan.md) — L03 project subagents in
  `.claude/agents/` (options → plan → implement → tests → verify → review → docs) and
  their guard hooks.
- [`onion-architecture-skill.md`](onion-architecture-skill.md) — the `onion-architecture`
  skill: layering rules for `server/` and `reviewer-core/`, enforced by dependency-cruiser.
- [`pr-self-review-skill.md`](pr-self-review-skill.md) — the `pr-self-review` skill and
  the hook that blocks `gh pr create` while a confirmed CRITICAL stands.
