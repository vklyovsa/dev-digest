# Mutation testing on one module

A mutation run changes the source in small ways (a mutant) and checks that a test notices.
It is a local check of the tests themselves, not a CI lane.

## Run

- Command: `cd server && pnpm mutation:eval-helpers` (direct form: `./node_modules/.bin/stryker run stryker.config.json`).
- Tool: Stryker `@stryker-mutator/core` and `@stryker-mutator/vitest-runner`, both 9.6.1.
- Target: `server/src/modules/eval/helpers.ts`, run against `test/eval-helpers.test.ts` and
  `test/eval-case-editor.test.ts` through `stryker.vitest.config.ts`.
- Taken on: base commit `1d4e77f` plus the uncommitted working tree of 2026-10-12 — the files were not
  committed yet, so the content is named by its hash: `helpers.ts`
  sha256 `09bd3e7f6efbfe1b…`. Repeat the command on the commit that holds these files to get a run with a commit SHA.
- Duration: 21 s (baseline), 7 s (re-run). No model call, no database.
- Report: `server/reports/mutation/mutation.json` and `mutation.html` (git-ignored, rewritten by each run).

## Baseline

| Mutants | Killed | Survived | No coverage | Timeout | Score |
|---|---|---|---|---|---|
| 206 | 132 | 17 | 57 | 0 | 64.08% (88.59% of covered) |

## Chosen mutant

- Where: `server/src/modules/eval/helpers.ts:145`, in `caseTaskLine`.
- Mutator: LogicalOperator. Original `meta.prNumber === null || meta.prAuthor === null`,
  replacement `meta.prNumber === null && meta.prAuthor === null`. Baseline status: Survived.
- Why it is not equivalent: for a case with a number and no author (`prNumber: 42`, `prAuthor: null`)
  the original returns the title-only task line, and the mutant returns the full line, with `#42` and
  the text `by null`.

## Added test

- `server/test/eval-helpers.test.ts` — "names the title alone when the stored case has a number and no author".
- It passes on the unmodified target. In the re-run the chosen mutant is Killed.

| Mutants | Killed | Survived | No coverage | Timeout | Score |
|---|---|---|---|---|---|
| 206 | 134 | 15 | 57 | 0 | 65.05% |

## Left alive

15 survived and 57 without coverage after the re-run. The uncovered ones sit in `parseCaseDiff`,
which only the DB-backed suites exercise, and those are outside the narrowed run.

## Earlier baselines, and why the target changed

The run was planned for `server/src/modules/eval/scoring.ts`. Its baseline left nothing to choose from,
and neither did the planned fallback, so the target moved twice:

| Target | Tests | Mutants | Killed | Survived | No coverage | Timeout | Score |
|---|---|---|---|---|---|---|---|
| `src/modules/eval/scoring.ts` | `src/modules/eval/scoring.test.ts` | 97 | 97 | 0 | 0 | 0 | 100% |
| `src/modules/pulls/findings-summary.ts` | `test/pulls-findings-summary.test.ts` | 28 | 28 | 0 | 0 | 0 | 100% |

## Two things the config needs here

- `"plugins": ["@stryker-mutator/vitest-runner"]` in `stryker.config.json`: under pnpm the runner is not
  found by itself (`Cannot find TestRunner plugin "vitest"`).
- `stryker.vitest.config.ts` resolves `../reviewer-core` from the real package root: Stryker runs the
  config from a sandbox two levels down (`.stryker-tmp/sandbox-*`), where that sibling path does not exist
  and every test fails to import (`No tests were executed`).
