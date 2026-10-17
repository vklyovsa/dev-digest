# Eval Pipeline — homework 6 index

The homework names this file. This repository keeps one dated spec per feature
([`README.md`](README.md)), so the requirements live in the eight specs below and this
page maps the homework onto them.

## Tasks and their specs

| Task (homework) | Spec | Plan |
|---|---|---|
| Core — eval cases from findings, suite run, code-only scoring, Evals tab, Eval Dashboard, compare, `verify:l06` | SPEC-03 [`2026-10-12-eval-pipeline.md`](2026-10-12-eval-pipeline.md) | [`2026-10-12-eval-pipeline-plan.md`](2026-10-12-eval-pipeline-plan.md) |
| Stretch — Case Editor (manual create / edit) | SPEC-04 [`2026-10-12-case-editor.md`](2026-10-12-case-editor.md) | [`2026-10-12-case-editor-plan.md`](2026-10-12-case-editor-plan.md) |
| Stretch — metric trend charts | SPEC-05 [`../client/specs/2026-10-12-eval-trend-charts.md`](../client/specs/2026-10-12-eval-trend-charts.md) | [`../client/specs/2026-10-12-eval-trend-charts-plan.md`](../client/specs/2026-10-12-eval-trend-charts-plan.md) |
| Stretch — eval of an own skill in `evals/` | SPEC-06 [`2026-10-12-own-skill-eval.md`](2026-10-12-own-skill-eval.md) | [`2026-10-12-own-skill-eval-plan.md`](2026-10-12-own-skill-eval-plan.md) |
| Stretch — PreToolUse commit test gate | SPEC-07 [`2026-10-12-commit-test-gate.md`](2026-10-12-commit-test-gate.md) | [`2026-10-12-commit-test-gate-plan.md`](2026-10-12-commit-test-gate-plan.md) |
| Stretch — mutation testing on one file | SPEC-08 [`../server/specs/2026-10-12-mutation-testing-on-one-file.md`](../server/specs/2026-10-12-mutation-testing-on-one-file.md) | [`../server/specs/2026-10-12-mutation-testing-on-one-file-plan.md`](../server/specs/2026-10-12-mutation-testing-on-one-file-plan.md) |
| Mentor's condition — eval case modal (Run case, Save / Cancel); Run on save, per-case run, Run all agents, row sparkline, Promote vN | SPEC-09 [`2026-10-13-eval-case-modal.md`](2026-10-13-eval-case-modal.md) | [`2026-10-13-eval-case-modal-plan.md`](2026-10-13-eval-case-modal-plan.md) |
| Mentor's optional item — eval cases owned by a skill, an Evals tab in the Skill Editor | SPEC-10 [`2026-10-13-skill-evals.md`](2026-10-13-skill-evals.md) | [`2026-10-13-skill-evals-plan.md`](2026-10-13-skill-evals-plan.md) |

## Homework acceptance criteria → SPEC-03

| Homework criterion | Acceptance criteria |
|---|---|
| A set of at least 8 cases | AC-93, AC-94, AC-95 |
| A case is created from a finding; `must_find` and `must_not_flag` both work. The click opens the prefilled case modal and Save stores the case (SPEC-09) | SPEC-09 AC-1 … AC-35; SPEC-03 AC-52, AC-53 |
| A system-prompt change visibly moves recall / precision between two runs | "Run history and comparison", AC-55, AC-56, AC-60 |
| Scoring makes no LLM call | AC-50 … AC-59, AC-97 |
| `pnpm verify:l06` is green | AC-96 |

## Additional condition from the course mentor (2026-10-12)

"Turn into eval case" must not store a case on the click. The criteria, as given:

| # | Condition |
|---|---|
| M-1 | The button is active only for a finding that is already accepted or dismissed (accepted → `must_find`, dismissed → `must_not_flag`). |
| M-2 | A click stores nothing; it opens the eval case modal. |
| M-3 | The modal is prefilled from the finding: the diff, the PR meta, the case name and the expected output. |
| M-4 | In the modal the case is warmed up: the diff and the expectation can be edited, and "Run case" shows the agent's actual result with pass / fail — as many times as needed. |
| M-5 | Only "Save" puts the case into the agent's set (Evals tab, "Eval cases"); "Cancel" leaves no case. |
| M-6 | Optional: evals for skills and an Evals tab in the Skill Editor. |
| M-7 | Lab skeleton committed: `evals/`, at least one skill eval, one agent eval and a workflow case, the eval commands and the "which change → which run" rule in the instruction file, and three pipelines `eval-skills.yml`, `eval-agents.yml`, `eval-workflow.yml` under `.github/workflows/`. |

M-1 … M-7 are met; the optional M-6 is SPEC-10 ([`2026-10-13-skill-evals.md`](2026-10-13-skill-evals.md)). Spec for M-1 … M-5 and for the design elements built with it: SPEC-09 ([`2026-10-13-eval-case-modal.md`](2026-10-13-eval-case-modal.md)); it supersedes the one-click behaviour of SPEC-03. M-7: `evals/`, `AGENTS.md` § Harness evals, and the three files under `.github/workflows/`.

How it works and how to use it: [`../docs/eval-pipeline.md`](../docs/eval-pipeline.md). Evidence of the experiment: [`fixtures/eval-pipeline/`](fixtures/eval-pipeline/).

## Deliberate deviations from the design frames

"Run case", "Run on save", the per-case run, "Run all agents", the row sparkline and "Promote vN" are built (SPEC-09). Still not built, each a named non-goal:

- The "Files" tab and "Linked issue" — SPEC-04 NG-7, SPEC-09 NG-2.
- The JSON "Expected output" editor — SPEC-04 NG-8, SPEC-09 NG-1.
- The "30 days" range control — SPEC-05 NG-4, SPEC-09 NG-3.
- For skill evals: a without-skill baseline, a skill case from a finding, skills on the Eval Dashboard, the trend chart and Promote on the skill tab — SPEC-10 NG-1 … NG-5.

Deviations from SPEC-09 as built:

- "Promote vN" always adds a new agent version: `PUT /agents/:id` is unchanged, so the "unchanged" answer (AC-87) is not reachable from the API — plan § 7, F1.
- "Promote vN" restores the seven configuration values of the version, not its skill links (AC-84).
