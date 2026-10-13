# Spec: Mutation testing on one file
Spec ID: SPEC-08
Status: implemented
Supersedes: none

## Problem and user

The user is the **maintainer of the `server/` test suites** (the author of the unit tests,
in the repository rather than in the product). A green unit lane says that the current
code passes; it says nothing about the tests themselves — whether they would notice a
swapped operator, a moved boundary or a removed branch (IN-1: «Зелені тести кажуть
«поточний код проходить», але мовчать про якість самих тестів: чи впіймають вони підміну
логіки»).

Nothing in this repository measures that today: no mutation tool is installed
(`server/pnpm-lock.yaml` holds no `stryker` entry), no config for one exists, and
`TESTING.md` states that line coverage is not chased and names no other measure of test
quality (IN-8, IN-9).

The gap matters most where a wrong answer is silent. The code-only scoring of the Eval
Pipeline (SPEC-03, `specs/2026-10-12-eval-pipeline.md`) turns an agent's findings into
recall, precision and citation accuracy; every number the Eval Dashboard shows rests on a
file-equality test, a line-range intersection and three ratios with zero divisors. A
boundary error there does not fail a request — it shifts a metric, and the user reads the
shift as the agent's quality (IN-6). The lesson's bonus material runs the mutation tool on
exactly that module (IN-3, IN-5).

## Goals / Non-goals

- **G-1** One command, run locally from `server/`, mutates one module and reports how many mutants were killed, survived, had no coverage and timed out.
- **G-2** One surviving mutant is killed by one added test, and the state before and after is recorded in the repository so that a reader checks it without the author's machine.
- **G-3** The run stays local and bounded: no model call, no database, no CI lane, nothing of the tool's output in the commit.
- **G-4** The tool and its command reach a commit in a form that CI installs and a fresh clone runs.

- **NG-1** Mutation testing in CI — the homework asks for one local run (IN-1, IN-2); `.github/workflows/**` stays as it is, and no lane, job or required check is added.
- **NG-2** A mutation score threshold, or a gate on the score — the homework asks to look at how many mutants survived, not to enforce a number (IN-1).
- **NG-3** Killing every surviving mutant, or classifying each one that remains — the homework asks for one (IN-1); the lesson's own run left 11 alive (IN-5). The proposal to classify the rest is DR-5.
- **NG-4** Mutating more than one source file, or a second package (`client/`, `reviewer-core/`, `mcp/`, `evals/`) — the task is «на одному файлі» (IN-1).
- **NG-5** Changing the target's source to make a mutant disappear — removing a branch, rewriting an expression, or a comment that tells the tool to skip a line; the homework asks to add a test («дописати тест, який його вбиває», IN-1).
- **NG-6** Building the eval scoring module — it is SPEC-03's work and is in the tree before this feature starts (IN-2, IN-6).
- **NG-7** The 10.x line of the mutation tool — the lesson's run found `@stryker-mutator/core@10.0.0` unusable and pinned 9.6.1 (IN-5).

## User stories

- **US-1** As a maintainer of the server tests, I want to run a mutation tool on one module with one command, so that I see how many swapped pieces of logic my tests let through.
- **US-2** As a maintainer of the server tests, I want one added test that kills one surviving mutant, so that one real gap in the tests is closed and shown to be closed.
- **US-3** As a reader of the homework, I want the counts before, the chosen mutant, the added test and the counts after written down in the repository, so that I verify the result by reading and by re-running one command.
- **US-4** As a repo owner, I want the run to stay local, hermetic and bounded, so that it costs no model call, reaches no database and adds nothing to CI.
- **US-5** As a contributor, I want the tool's dependency and command committed consistently, so that CI still installs `server/` and a fresh clone runs the same command.

## Acceptance criteria (EARS)

Terms. The **target** is the one source file the tool mutates. The **mutation run** is one
execution of the mutation command from `server/`. The **baseline** is the mutation run
taken before the added test exists; the **re-run** is the mutation run taken after it. The
**narrowed test config** is the vitest config the tool uses in place of
`server/vitest.config.ts`; the **narrowed test set** is the test files it includes. The
**mutation record** is the document of AC-11. The **change set** is everything this
feature adds or changes in the working tree.

### The setup

- **AC-1** [ubiquitous] The mutation config shall name exactly one source file to mutate, the eval scoring module of SPEC-03 — the file that decides whether a finding matches an expectation and computes recall, precision and citation accuracy; when SPEC-03 builds its scoring as several files, the one that holds the matching rule; the one exception is AC-25. — covers: US-1 · verify: unit — a test in the server unit lane reads the config: one entry to mutate, a file that exists, not a test file
- **AC-2** [ubiquitous] The narrowed test config shall include only hermetic test files that import the target, and no file whose name ends in `.it.test.ts`. — covers: US-1 · verify: unit — the same test resolves the included files: each exists, each imports the target, none ends in `.it.test.ts`
- **AC-3** [ubiquitous] The narrowed test config shall carry the same `DATABASE_URL` value and the same `@devdigest/shared` and `@devdigest/reviewer-core` aliases as `server/vitest.config.ts`. — covers: US-4 · verify: unit — the same test imports both configs and compares `test.env.DATABASE_URL` and `resolve.alias`
- **AC-4** [event-driven] WHEN the mutation command is run from `server/` on a tree where the server unit lane passes, the mutation run shall finish with a report that gives the total number of mutants, the number in each of the statuses killed, survived, no coverage and timeout, and the mutation score. — covers: US-1 · verify: manual — the report of the baseline; a test does not start the mutation tool, which re-runs the narrowed test set once per mutant

### Killing one mutant

- **AC-5** [ubiquitous] The mutation record shall name as the chosen mutant one mutant that the baseline report lists as survived or, when it lists none as survived, one that it lists with no coverage, and say which of the two statuses the mutant had. — covers: US-2 · verify: manual — the chosen mutant's file, line, mutator and replacement are found with that status in the baseline report, and the report's survived count is 0 when a no-coverage mutant was chosen; the report exists only after a run
- **AC-6** [ubiquitous] The mutation record shall state for the chosen mutant one input to an exported function of the target and the two different results that the original code and the mutated code return for it. — covers: US-2 · verify: manual — a reading of the record against the target: the stated results differ, which shows that the mutant is not an equivalent one; a judgement no test observes
- **AC-7** [ubiquitous] The server unit lane shall hold one added test that asserts the original result of AC-6 for that input and passes on the unmodified target. — covers: US-2 · verify: unit — the added test in `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- **AC-8** [event-driven] WHEN the mutation command is run again after the test is added, the mutation run shall report the chosen mutant — the same file, line, mutator and replacement — as killed. — covers: US-2 · verify: manual — the re-run's report; produced by the mutation tool
- **AC-9** [ubiquitous] The mutation run shall report in the re-run the same total number of mutants as in the baseline. — covers: US-2 · verify: manual — the two totals in the record and in the re-run's report; an equal total shows that no mutant was excluded between the runs
- **AC-10** [ubiquitous] The change set shall leave the target's source file byte-identical between the baseline and the re-run. — covers: US-2 · verify: manual — `git log` and `git status --short` for the target's path between the baseline commit named in the record and the re-run; no test observes history
- **AC-25** [unwanted] IF the baseline on the eval scoring module lists no mutant as survived and none with no coverage, THEN the mutation config shall name `server/src/modules/pulls/findings-summary.ts` as its one source file to mutate, with `server/test/pulls-findings-summary.test.ts` as the narrowed test set. — covers: US-2 · verify: unit — the test of AC-1 holds for the changed config; the condition itself is read from the first baseline's report
- **AC-18** [ubiquitous] The narrowed test set shall differ between the baseline and the re-run by the added test alone. — covers: US-2 · verify: manual — `git status --short` and `git log` for the files of the narrowed test set between the two runs; no test observes history

### The record

- **AC-11** [ubiquitous] The mutation record shall live in `server/docs/mutation-testing.md`, listed under Contents in `server/docs/README.md` and under "Read when" in `server/AGENTS.md`. — covers: US-3 · verify: manual — a reading of the three files; no test guards documentation
- **AC-12** [ubiquitous] The mutation record shall state the mutation command, the tool's name and version, the target's path, the short commit SHA the baseline was taken on, the duration the run printed and the report file the counts were read from. — covers: US-3 · verify: manual — a reading of the record; a re-run of the stated command on the stated commit reproduces the counts
- **AC-13** [ubiquitous] The mutation record shall give for the baseline the total number of mutants, the numbers killed, survived, with no coverage and timed out, and the mutation score, as the baseline report prints them. — covers: US-3 · verify: manual — the six values against the baseline report; a count of zero is written as 0
- **AC-14** [ubiquitous] The mutation record shall quote the chosen mutant as the target's path with its line, the mutator's name, the original text and the replacement text. — covers: US-3 · verify: manual — the quote against the baseline report and against the target's line
- **AC-15** [ubiquitous] The mutation record shall name the added test by file and test title and give for the re-run the same six values as AC-13. — covers: US-3 · verify: manual — the title is found in the named file; the six values against the re-run's report
- **AC-16** [unwanted] IF mutants are still listed as survived or with no coverage after the re-run, THEN the mutation record shall state their number and that they were left alive. — covers: US-3 · verify: manual — the number against the re-run's report
- **AC-26** [unwanted] IF the target was changed under AC-25, THEN the mutation record shall also give the six values of AC-13 for the first baseline, taken on the eval scoring module, and say why the target changed. — covers: US-3 · verify: manual — the six values against the first baseline's report; produced by the mutation tool
- **AC-24** [ubiquitous] The testing guide `TESTING.md` shall hold under "Running locally" one line that names the mutation command and says that it is run locally and is not a CI lane. — covers: US-3 · verify: manual — a reading of that section; no test guards documentation

### Local, hermetic, out of CI

- **AC-17** [ubiquitous] The change set shall leave every file under `.github/workflows/` unchanged. — covers: US-4 · verify: manual — `git status --short .github` prints nothing; no test observes the working tree
- **AC-19** [event-driven] WHEN a mutation run has finished or was stopped mid-way, the working tree shall show in `git status --short` no file or folder that the run created. — covers: US-4 · verify: manual — `git status --short` before and after a run and after an interrupted run; it needs a run

### Reaching the commit

- **AC-20** [ubiquitous] The server package shall declare `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` as development dependencies at exactly `9.6.1` in `server/package.json`, resolved in `server/pnpm-lock.yaml`, with the manifest and the lockfile changed together by `pnpm add -D`. — covers: US-5 · verify: unit — the test of AC-1 reads `server/package.json`: both entries equal `9.6.1` with no range prefix; `grep -n "@stryker-mutator" server/pnpm-lock.yaml` shows both at 9.6.1
- **AC-21** [ubiquitous] The server package shall expose the mutation run as one `package.json` script that takes no argument and equals the direct form `pnpm exec stryker run` with the mutation config. — covers: US-5 · verify: unit — the test of AC-1 reads the script's text
- **AC-22** [event-driven] WHEN `pnpm install --frozen-lockfile` runs in `server/` on the commit that holds the change set, the server package shall install without a lockfile error. — covers: US-5 · verify: manual — the install step of the `server unit` and `server integration` workflows on that commit (`.github/workflows/server-unit.yml:58`, `.github/workflows/server-integration.yml:51`); an install is not a test
- **AC-23** [ubiquitous] The change set shall leave `server/pnpm-workspace.yaml` unchanged. — covers: US-5 · verify: manual — `git status --short server/pnpm-workspace.yaml` prints nothing; no test observes the working tree

## Edge cases

- **EC-1** The eval scoring module of SPEC-03 is not in the tree when this work is planned (`server/src/modules/eval/` does not exist at 1d4e77f) → the work waits for it; no other file is mutated in its place — covered by: AC-1
- **EC-2** SPEC-03's scoring is built as more than one source file → exactly one of them is mutated: the one that holds the matching rule — covered by: AC-1
- **EC-3** The lesson keeps the scoring test beside the code (`src/modules/eval/scoring.test.ts`, IN-3); this repository keeps every server test under `server/test/` (54 files there, none under `server/src/`) → the narrowed test set names the test files wherever SPEC-03's work put them — covered by: AC-2
- **EC-4** The baseline lists no mutant as survived (a score of 100%, or only mutants with no coverage) → a mutant with no coverage is chosen under the same rule of AC-6; when the baseline has neither, the target changes to the fallback and the first baseline stays in the record — covered by: AC-5, AC-25, AC-26
- **EC-5** The chosen survivor is an equivalent mutant: no input to an exported function tells it from the original, as with the branches the lesson's run found unreachable (IN-5) → not a valid choice; another survivor is chosen — covered by: AC-6
- **EC-6** The added test passes on the original and on the mutated code alike → the mutant is still alive and the work is not done — covered by: AC-8
- **EC-7** The added test kills more than the chosen mutant (the lesson's one test killed two on the same two lines, IN-5) → accepted; the record quotes the chosen one and the re-run's counts show the rest — covered by: AC-14, AC-15
- **EC-8** A mutant makes a test loop until the tool stops it → it is counted as timeout, not as killed and not as survived — covered by: AC-4, AC-13
- **EC-9** The target or a test of the narrowed set is edited for another reason between the two runs (SPEC-03 still in work) → the two reports are not comparable and both runs are taken again — covered by: AC-9, AC-10, AC-18
- **EC-10** `pnpm add -D` without a version resolves the 10.x line, whose Babel 8 tree stopped every run with `ERR_REQUIRE_ESM` in the lesson's run (IN-5) → the two packages are pinned to exactly 9.6.1 — covered by: AC-20
- **EC-11** The crash survives the downgrade because nested `node_modules` folders of the failed install stay on disk through `pnpm install --force`; the lesson's run cleared it only with a full removal of `server/node_modules` and a new install (IN-5) → the baseline counts only once a run completes — covered by: AC-4
- **EC-12** pnpm 12 exits non-zero with `ERR_PNPM_IGNORED_BUILDS` after it wrote `package.json` and the lockfile, and rewrites the `allowBuilds:` stub of `server/pnpm-workspace.yaml` (IN-9) → the add is judged by the lockfile, the build-approval prompt is not answered on the user's behalf, and the stub's change does not enter the change set — covered by: AC-20, AC-23
- **EC-13** `AGENTS.md` § Do not touch calls `server/package.json` `skip-worktree`; measured in this clone on 2026-10-12, no file carries that bit (`git ls-files -v server/package.json` prints `H`, and the file equals the committed one), so the added script and development dependencies show in `git status` like any other change → the manifest and the lockfile are committed together, and the frozen install proves it — covered by: AC-20, AC-22
- **EC-14** A run is interrupted and leaves the tool's temp folder behind → git ignores it; the next run is not blocked by it — covered by: AC-19
- **EC-15** The tool builds its working copy from the package folder, which holds `server/clones/**` (checkouts of imported repositories, of any size) → nothing under `clones/` is copied or read — covered by: NFR-4
- **EC-16** The dev stack is up, or a review is in flight, while a mutation run executes → the run does not reach the dev database, so no `agent_runs` row is touched (`server/INSIGHTS.md` § What Doesn't Work, 2026-09-23) — covered by: AC-3, NFR-2
- **EC-17** The reports are git-ignored and exist on the machine that ran them only → the record carries the numbers, the commit and the command, and a re-run reproduces them — covered by: AC-12, AC-13

## Non-functional requirements

- **NFR-1** [cost] A mutation run makes no model call: the target and every file of the narrowed test set import no model provider and nothing under `server/src/adapters/`, and the run completes with no provider key in the environment. — verify: `grep -n "adapters/"` over the target and the narrowed test set prints nothing; the baseline is taken with `OPENROUTER_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` unset
- **NFR-2** [security] A mutation run opens no database connection: the narrowed test set holds no `*.it.test.ts` file, imports neither `test/helpers/pg.ts` nor the app builder, and resolves `DATABASE_URL` to the address nothing listens on. — verify: AC-2, AC-3; the baseline completes with Docker stopped
- **NFR-3** [performance] A mutation run finishes within 5 minutes on the user's machine (IN-10); the lesson's run of 161 mutants took about 20 seconds with a narrowed test config (IN-5). — verify: the duration the run prints, recorded by AC-12
- **NFR-4** [performance] A mutation run copies and reads nothing under `server/clones/`. — verify: while a run is in progress, `find` over the tool's temp folder lists no path that contains `/clones/`
- **NFR-5** [compatibility] The change set changes no non-test source file under `server/src/` and no file of `client/`, `reviewer-core/`, `mcp/`, `e2e/` or `evals/`, and the server unit lane passes with the added tests. — verify: `git status --short`; `.claude/agents/scripts/check-code.sh server`
- **NFR-6** [security] The mutation tool enters `server/` at exact versions through the package manager, the lockfile is never edited by hand, and no dependency build script is approved on the user's behalf. — verify: AC-20, AC-23; `git log -p server/pnpm-lock.yaml` shows a change written by `pnpm` together with the manifest's

## Module interactions

Packages: server
Surfaces: the mutation command, run from `server/` (in the lesson: the script `mutation:eval-scoring`, which is `stryker run stryker.config.json`); the mutation config and the narrowed test config (in the lesson: `server/stryker.config.json`, `server/stryker.vitest.config.ts`); one added unit test for the target; one unit test over the two configs; the mutation record; one line in `TESTING.md` § Running locally; ignore rules for the tool's temp and report folders

| # | From → To | Channel | Carries | Exists today | If it fails |
|---|---|---|---|---|---|
| MI-1 | mutation run → vitest | the narrowed test config | the files of the narrowed test set, the two path aliases, the `DATABASE_URL` pin | new; the values it copies exist (`server/vitest.config.ts:7`, `:18`) | the run stops before any mutant is tested and nothing counts as a baseline (AC-4) |
| MI-2 | mutation run → the target | the mutation config | one source path; back: one status per mutant | new; the target is built by SPEC-03 and is absent today (EC-1) | no report; the work waits for SPEC-03 (AC-1) |
| MI-3 | mutation run → the filesystem | the tool's temp folder and its report folder under `server/` | a working copy of the package; an HTML report and the console summary | new | a leftover folder stays git-ignored (AC-19) |
| MI-4 | server package → the npm registry | `pnpm add -D`, run once by whoever implements this | two packages at 9.6.1 and their dependency tree into `server/pnpm-lock.yaml` | new | pnpm 12 reports `ERR_PNPM_IGNORED_BUILDS` after the work is done (EC-12) |
| MI-5 | CI `server unit`, `server integration` → server package | `pnpm install --frozen-lockfile`, then the existing lanes | the manifest and the lockfile of the commit | yes (`.github/workflows/server-unit.yml:58`, `:98`, `.github/workflows/server-integration.yml:51`) | a manifest without its lockfile, or the reverse, fails the install (EC-13, AC-22) |
| MI-6 | server unit lane → the added tests | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | the added test of AC-7 and the config test of AC-1…AC-3, AC-20, AC-21 | yes (`.github/workflows/server-unit.yml:110`, `server/vitest.config.ts:14`) | the lane is red |

No boundary to Postgres, GitHub, a model provider or another package is crossed: the run
executes one pure module and its hermetic tests (NFR-1, NFR-2). What has to exist first:
the eval scoring module of SPEC-03 with its unit tests (EC-1).

## Design review

No design source was supplied.

| # | Kind | Finding | Proposal | Decision |
|---|---|---|---|---|
| DR-1 | module | The lesson's narrowed test config (IN-3) copies the aliases of `vitest.config.ts` and drops everything else; this repository's `vitest.config.ts:18` also pins `DATABASE_URL`, and `server/test/hermetic-env.test.ts` holds that pin | The narrowed test config carries the pin, and a unit test compares the two configs | accepted → AC-3 (IN-2) |
| DR-2 | inconsistency | The lesson's `include` is `src/modules/eval/scoring.test.ts` (IN-3); here every server test lives under `server/test/` | The narrowed test set is defined by what it holds — hermetic tests that import the target — not by a path | accepted → AC-2 |
| DR-3 | corner case | The lesson's `.gitignore` adds `reports/` and `.stryker-tmp/` for the whole repository (IN-4); this repository's `.gitignore` has neither | State the outcome, not the pattern: nothing a run creates shows in `git status` | accepted → AC-19 |
| DR-4 | ux | `TESTING.md` is where a reader looks for anything about test suites (`AGENTS.md` § Read when), and it would not mention the mutation command; the record of AC-11 is reached from `server/AGENTS.md` only | One line under `TESTING.md` § Running locally that names the command and says it is local-only, not a CI lane | accepted → AC-24 (IN-10) |
| DR-5 | corner case | The lesson's run left 11 survivors with a prose note on why (IN-5); AC-16 asks for their number only, so a reader does not learn which of them are equivalent | The record lists every remaining survivor with its line, its mutator and one of "equivalent" or "killable" | rejected — the user declined it (IN-10); the homework asks for one mutant, NG-3 |
| DR-6 | module | The lesson's commit holds its evidence in the commit message and in a `LEARNINGS.md` entry (IN-5); this repository has no `LEARNINGS.md`, and an `INSIGHTS.md` entry is 1–3 lines | A document under `server/docs/`, linked as `server/docs/README.md` requires | accepted → AC-11 (IN-10) |

## Inputs and provenance

| # | Source | Kind | Used for |
|---|---|---|---|
| IN-1 | homework text, `course-materials/materials/lesson6/hw6_description.txt:114-120`: «Mutation testing на одному файлі» · «Зелені тести кажуть «поточний код проходить», але мовчать про якість самих тестів: чи впіймають вони підміну логіки.» · «За бонус-матеріалом уроку прогнати мутаційний інструмент на одному модулі DevDigest і подивитися, скільки мутантів вижило; по одному вцілілому мутанту дописати тест, який його вбиває.» · «це евал для ваших тестів — той самий принцип «перевіряй перевіряльника», застосований на рівень нижче.» | user text | Problem, G-1, G-2, US-1, US-2, NG-1…NG-5 |
| IN-2 | task text of the calling session, 2026-10-12: SPEC-08; the natural target is the code-only scoring module of SPEC-03, built on this branch before this task, referred to without a path; a fallback target that exists today; the narrowed config keeps the hermetic guarantee; not in CI, as a non-goal; the evidence is verifiable (counts before, the chosen mutant quoted, the test added, the re-run), with a place for the record; equivalent mutants are handled; a time bound, no model call, no database; how the command and the dependency reach a commit given `skip-worktree`; the user answered "take all recommended" for this homework | user text | G-3, G-4, US-3…US-5, NG-1, NG-6, AC-3, AC-5…AC-16, AC-22, NFR-1, NFR-2 |
| IN-3 | the lesson's bonus material in the course's upstream remote: `git show base/full-functionality:server/stryker.config.json` (`testRunner: vitest`, `mutate: ["src/modules/eval/scoring.ts"]`, reporters `html`, `clear-text`, `progress`, `coverageAnalysis: perTest`, `tempDirName: .stryker-tmp`), `base/full-functionality:server/stryker.vitest.config.ts` (the two aliases, `include: ['src/modules/eval/scoring.test.ts']`, no `env`), `base/full-functionality:server/package.json` (script `mutation:eval-scoring`, both `@stryker-mutator` packages at `^9.6.1`, `vitest ^2.1.8`) @ 3ac8179 | repository | the tool, AC-1, AC-2, AC-20, AC-21, DR-1, DR-2, EC-3, MI-1…MI-3 |
| IN-4 | `git show base/full-functionality:.gitignore` lines 11-12 (`reports/`, `.stryker-tmp/`) @ 3ac8179 | repository | AC-19, DR-3 |
| IN-5 | the lesson's commit `0b88382` (2026-09-07, "test(server): mutation testing on eval scoring.ts, kill 2 survivors": a run of about 20 s, baseline 148 of 161 killed, 150 of 161 after one boundary test, 11 survivors left) and `git show base/full-functionality:server/LEARNINGS.md` lines 622-673 (`@stryker-mutator/core@10.0.0` and Babel 8, the pin to 9.6.1, stale nested `node_modules`, which survivors are unreachable) | repository | NG-3, NG-7, AC-16, AC-20, EC-5, EC-7, EC-10, EC-11, NFR-3, DR-5, DR-6 |
| IN-6 | `specs/2026-10-12-eval-pipeline.md` (SPEC-03, approved) § Scoring — its criteria 50 to 59: file equality with a shared line, grounded findings only, pass and fail per expectation type, the three ratios, a null metric on a zero divisor, errored cases left out — and its first cost requirement (scoring imports no model provider) | repository | Problem, AC-1, EC-1, EC-2, NFR-1 |
| IN-7 | `server/src/modules/pulls/findings-summary.ts` (84 lines; imports `scoreFromFindings` and the `Severity` enum only) with `server/test/pulls-findings-summary.test.ts` (120 lines) @ 1d4e77f | code | the fallback target of AC-25 |
| IN-8 | `server/vitest.config.ts`, `server/test/hermetic-env.test.ts`, `server/package.json`, `server/pnpm-lock.yaml`, `server/pnpm-workspace.yaml`, `server/.npmrc`, `.gitignore`, `.github/workflows/server-unit.yml`, `.github/workflows/server-integration.yml` @ 1d4e77f | code | Problem, AC-3, AC-17, AC-22, AC-23, MI-1, MI-5, MI-6, NFR-5 |
| IN-9 | `AGENTS.md` (§ Do not touch, § Conventions), `server/AGENTS.md`, `TESTING.md` (§ Philosophy, § Suite map, § Conventions), `INSIGHTS.md` § Tool & Library Notes (pnpm 12.4.2 and `ERR_PNPM_IGNORED_BUILDS`, 2026-09-28; the `allowBuilds:` stub, 2026-10-12), `server/INSIGHTS.md` § What Doesn't Work (the dev database and the unit lane, 2026-09-23 and 2026-10-04), `server/docs/README.md`, `server/specs/README.md` | repository | Problem, AC-11, AC-23, EC-12, EC-13, EC-16, NFR-2, NFR-4, NFR-6, DR-4, DR-6 |
| IN-10 | answers, 2026-10-12, relayed by the calling session: the user chose «Бери рекомендовані сам» — every recommended option is taken: (1) the target is the eval scoring module of SPEC-03 and the work waits for it; (2) `pnpm add -D` of both `@stryker-mutator` packages at exactly 9.6.1, one script, manifest and lockfile together; (3) the record lives in `server/docs/mutation-testing.md`, linked from `server/docs/README.md` and `server/AGENTS.md`; (4) a run is bounded at 5 minutes; (5) with no survived mutant a no-coverage mutant is chosen, and with neither the target changes to the fallback; the `TESTING.md` line is accepted and the classification of every remaining survivor is rejected. Measured by the calling session the same day: `git ls-files -v` shows `H` for `server/package.json` and no file of this clone carries the skip-worktree bit. SPEC-03 is `Status: approved` | user answer | AC-1, AC-5, AC-11, AC-20, AC-21, AC-24, AC-25, AC-26, NFR-3, EC-1, EC-2, EC-4, EC-13, DR-4, DR-5, DR-6 |

| Items | Origin | Source |
|---|---|---|
| G-1, G-2, US-1, US-2 | stated | IN-1 |
| G-3, G-4, US-3, US-4, US-5 | stated | IN-2 |
| NG-1 | stated | IN-1, IN-2 |
| NG-2, NG-3, NG-4, NG-5 | stated | IN-1 |
| NG-6 | stated | IN-2 |
| NG-7 | stated | IN-5 |
| AC-1, AC-5, AC-11, AC-20, AC-21, AC-24, AC-25, AC-26, NFR-3 | stated | IN-10 |
| AC-2 | code | IN-3, IN-8 |
| AC-3 | stated | IN-2 |
| AC-4, AC-7, AC-8 | stated | IN-1 |
| AC-6, AC-9, AC-10, AC-12, AC-13, AC-14, AC-15, AC-18 | stated | IN-2 |
| AC-16 | stated | IN-5 |
| AC-17 | stated | IN-2 |
| AC-19 | stated | IN-4 |
| AC-22 | stated | IN-2 |
| AC-23 | code | IN-9 |
| EC-1, EC-2, EC-4, EC-13 | stated | IN-10 |
| EC-3, EC-14, EC-15, EC-16 | code | IN-8, IN-9 |
| EC-5, EC-6, EC-9, EC-17 | stated | IN-2 |
| EC-7, EC-8, EC-10, EC-11 | stated | IN-5 |
| EC-12 | code | IN-9 |
| NFR-1, NFR-2 | stated | IN-2 |
| NFR-4, NFR-5, NFR-6 | code | IN-9 |

## Untrusted inputs

None — the run reads the target's source, its unit tests and their fixtures, all written in
this repository; no pull request text, imported repository file or model output reaches
it, and it sends nothing to a model, SQL, a browser or an outgoing URL. `server/clones/**`
is the one folder of repository-controlled content inside the package, and the run does
not read it (NFR-4). The tool itself is third-party code that runs locally; it is held by
exact versions and the lockfile (NFR-6).

## Traceability

| Goal | Stories | Criteria | Edge cases | NFR |
|---|---|---|---|---|
| G-1 | US-1 | AC-1, AC-2, AC-4 | EC-1, EC-2, EC-3, EC-8, EC-11 | NFR-3 |
| G-2 | US-2, US-3 | AC-5…AC-16, AC-18, AC-24, AC-25, AC-26 | EC-4, EC-5, EC-6, EC-7, EC-9, EC-17 | — |
| G-3 | US-4 | AC-3, AC-17, AC-19 | EC-14, EC-15, EC-16 | NFR-1, NFR-2, NFR-4 |
| G-4 | US-5 | AC-20…AC-23 | EC-10, EC-12, EC-13 | NFR-6 |
| — | — | — | — | NFR-5 |

## Open questions

None — the seven questions of the first draft were answered on 2026-10-12 (IN-10).
