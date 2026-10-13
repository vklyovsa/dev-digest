# Spec: Own skill eval
Spec ID: SPEC-06
Status: implemented
Supersedes: none

## Problem and user

The user is the author of the project skills under `.claude/skills/` (an agent author, in
the harness rather than in the product). A skill written in lesson 2 has no regression
protection: an edit to its description or its instructions changes what a session does
with it, and nothing reports that — the author learns of it later, from a review that
reads wrong (IN-1). Today `evals/skills/` holds one suite, for `dependency-checker`; for
every other skill `pnpm eval:quality` prints `no eval file`, and the CI detector logs
`SKIP skill <name> (no evals …)` when such a skill changes (IN-5, IN-7).

The skill chosen for the suite is `onion-architecture`, written in lesson 2 (IN-13).

## Goals / Non-goals

- **G-1** The chosen skill has a suite of 3 to 4 model-backed cases in the `evals/`
  package that passes on the skill as it is today.
- **G-2** The suite is shown to detect a regression: with one rule taken out of the skill
  it is red, with the rule back it is green, and both results are recorded.
- **G-3** The model-backed runs the work needs are named and bounded before any of them
  starts.
- **G-4** A later edit to the skill gets the suite run: the static gate stops warning,
  and the CI detector picks the suite instead of logging a skip.
- **NG-1** The product's Skill Editor · Evals tab that `img_6.png` shows — the task names
  the `evals/` package and a file path in it; the frame is a product design, not the
  shape of that file (DR-1).
- **NG-2** A change to the eval engine (`evals/src/**`), to `evals/scripts/ci-detect.mjs`
  or to `.github/workflows/evals.yml` — the task asks for the lab's mechanism on a new
  artifact, and the mechanism already serves any `evals/skills/<name>/` folder.
- **NG-3** Suites for the user's other skills — the task asks for one skill.
- **NG-4** An activation (triggering) case for the skill in the workflow tier — the user
  left it out; a `skillTask` case does not see whether a session activates the skill, so
  an edit to the `description` that breaks triggering stays undetected (DR-2).
- **NG-5** A permanent change to the content of `.claude/skills/onion-architecture/` — the
  user's decision; the only edit is the temporary one of the break step, and the cases
  use what `SKILL.md` and `references/*.md` state today.

## User stories

- **US-1** As a skill author, I want a suite of 3 to 4 cases for my skill that one command
  runs, so that an edit to the skill is checked against fixed expectations.
- **US-2** As a skill author, I want every verdict to carry the judge's evidence quote and
  every concrete fact to be checked without a model first, so that I calibrate a practice
  by reading and pay the judge only for what a substring does not settle.
- **US-3** As a skill author, I want recorded proof that the suite goes red when the skill
  is broken and green when it is restored, so that a green result means something.
- **US-4** As a skill author, I want an edit to the skill to select the suite in CI and to
  clear the static warning, so that the check does not depend on my remembering it.
- **US-5** As a subscription owner, I want the model-backed runs limited to named
  commands on named models, so that the task does not spend more than was agreed.

## Acceptance criteria (EARS)

- **AC-1** [ubiquitous] The eval suite shall cover the skill `onion-architecture` — covers: US-1 · verify: unit — the folder name under `evals/skills/` and the skill name passed in the eval file
- **AC-2** [ubiquitous] The eval suite shall be collected from
  `evals/skills/onion-architecture/onion-architecture.eval.ts` — covers: US-1 · verify: unit — `cd evals && pnpm exec vitest list skills/onion-architecture` prints the file, with no model call
- **AC-3** [ubiquitous] The eval suite shall hold at least 3 and at most 4 cases — covers: US-1 · verify: unit — the number of tests `pnpm exec vitest list skills/onion-architecture` prints
- **AC-4** [ubiquitous] The eval suite shall run every case through `skillTask` with the
  skill's content as the system prompt — covers: US-1 · verify: unit — the eval file holds `describeSkill` with `runSkillCases` and no other runner
- **AC-5** [ubiquitous] The eval suite shall inline each case's fixture into the prompt
  from `evals/skills/onion-architecture/fixtures/` — covers: US-1 · verify: unit — every fixture a prompt uses is a file in that folder, and no file is added under `.claude/skills/onion-architecture/`
- **AC-6** [ubiquitous] The eval suite shall give every case at least one practice for the
  judge — covers: US-2 · verify: unit — the `practices` array of each case in the case data
- **AC-7** [optional] WHERE a case expects a literal string in the output, the eval suite
  shall check that string through the case's `grounding` gate before the judge runs — covers: US-2 · verify: unit — the `grounding` array of that case; `evals/src/dsl/case.ts` skips the judge when the gate is below 1
- **AC-8** [ubiquitous] The eval suite shall name in every practice an identifier, a
  heading or a format that the skill's `SKILL.md` or `references/*.md` states — covers: US-2 · verify: unit — each quoted identifier of a practice is found by `grep` in those files
- **AC-9** [ubiquitous] The eval suite shall word every practice as a positive statement
  that one verbatim quote from the output proves — covers: US-2 · verify: manual — a reading of the practices: none asserts an absence; a judgement of wording, which no test observes
- **AC-10** [event-driven] WHEN `pnpm exec vitest run skills/onion-architecture` runs against the
  unmodified skill on the models of NFR-2, the eval suite shall pass every case — covers: US-1 · verify: manual — the vitest summary of that run; model-backed and paid, so no agent-written test repeats it
- **AC-11** [event-driven] WHEN a case finishes, the eval suite shall append a record to
  `evals/results/records.jsonl` that holds `passed` and `evidence` for each practice — covers: US-2 · verify: manual — the record of a run of AC-10; it exists only after a model-backed run
- **AC-12** [event-driven] WHEN the baseline series is recorded, the eval suite shall show
  no practice that failed in every run of that series — covers: US-2 · verify: manual — the per-practice counts in `evals/results/repeat-onion-architecture-full.json`; produced by a model-backed run
- **AC-13** [event-driven] WHEN one rule that the skill states is removed from the skill
  and the suite is run as a labelled series, the eval suite shall record `outcome: false`
  for the case tied to that rule in every run of the series — covers: US-3 · verify: manual — `evals/results/repeat-onion-architecture-broken.json`; produced by a model-backed run
- **AC-14** [event-driven] WHEN the removed rule is restored and the suite is run as a
  labelled series, the eval suite shall pass every case in every run of the series — covers: US-3 · verify: manual — `evals/results/repeat-onion-architecture-restored.json`; produced by a model-backed run
- **AC-15** [ubiquitous] The eval suite shall keep the same case names and the same
  practice texts across the three labelled series: full, broken and restored — covers: US-3 · verify: unit — a comparison of the three `repeat-<label>.json` files, with no model call
- **AC-16** [ubiquitous] The eval suite shall hold exactly 2 runs of every case in each
  labelled series — covers: US-3 · verify: unit — `times` and the per-test run counts in each `repeat-<label>.json`
- **AC-17** [event-driven] WHEN the restored series is recorded, the working tree shall
  show `.claude/skills/onion-architecture/` identical to its state before the break — covers: US-3 · verify: unit — `git diff --stat -- .claude/skills/onion-architecture` prints the same as before the break
- **AC-18** [event-driven] WHEN `pnpm eval:quality` runs, the static gate shall report the
  chosen skill without the `no eval file` warning — covers: US-4 · verify: unit — the gate's output for the skill; no model call
- **AC-19** [event-driven] WHEN the changed-file list holds a path under
  `.claude/skills/onion-architecture/` or under `evals/skills/onion-architecture/`, the CI detector shall emit
  the skill in its `skills` output — covers: US-4 · verify: unit — `CHANGED_FILES=<path> node evals/scripts/ci-detect.mjs` prints `skills=["onion-architecture"]` and an empty `skipped_skills`
- **AC-20** [event-driven] WHEN `pnpm typecheck` runs in `evals/`, the evals package shall
  report no error — covers: US-4 · verify: unit — the exit code of the command; the `static` job of `evals.yml` blocks a pull request on it
- **AC-21** [ubiquitous] The records written to `evals/results/records.jsonl` while the
  feature is built shall name no suite other than `skills/onion-architecture` — covers: US-5 · verify: unit — the `nodeid` of every record whose `run_id` falls in that period, read with no model call
- **AC-22** [event-driven] WHEN the restored series is recorded, the root `INSIGHTS.md`
  shall hold one entry that names the three series files and the per-practice pass counts
  of each — covers: US-3 · verify: unit — a reading of the entry against the three `repeat-onion-architecture-<label>.json` files, with no model call
- **AC-23** [event-driven] WHEN `pnpm eval:benchmark skills/onion-architecture -n 3`
  finishes, the eval suite shall keep no practice that the benchmark report flags
  `non_discriminating` — covers: US-2 · verify: unit — the flags in `evals/results/benchmarks/<timestamp>/benchmark.md` compared with the practice texts of the case data, with no model call

## Edge cases

- **EC-1** A rule a case needs is stated only in the skill's `rules/*.md`, `examples.md`
  or a script, which a skill case never sees (`skillContent` reads `SKILL.md` and
  `references/*.md` only) → the case is built on what `SKILL.md` states; the text does
  not move (NG-5) — covered by: AC-8
- **EC-2** `SKILL.md` tells the model to read another file before answering, while the
  session has no tools and is told so → the skill gets no "already in the prompt" branch
  (NG-5); the case prompt hands over what the answer needs, and a case that still draws
  a request for the file is not green — covered by: AC-10
- **EC-3** A practice passes without the skill as well (recall on a seeded layering
  violation is 15/15 with and without `onion-architecture` on Sonnet) → such a practice
  shows no regression; the suite counts only when the break turns it red — covered by: AC-8, AC-13
- **EC-4** The rule is removed, the practice tied to it fails, and the case still passes
  because its threshold tolerates one failed practice (the `dependency-checker` break of
  2026-10-12 moved a practice 2/2 → 0/2 inside a passing case) → not a red test; the case
  outcome itself has to be false — covered by: AC-13
- **EC-5** A series is mixed: 1 of 2 runs red after the break, or 1 of 2 green after the
  restore → not accepted as evidence; the case is calibrated and the three series taken
  again — covered by: AC-13, AC-14
- **EC-6** A practice or a case is reworded between two of the three series → the
  statistics start a new series for it and the before/after comparison is void — covered by: AC-15
- **EC-7** An earlier run was killed and its orphaned vitest process appends a record
  later, so a series counts a case more often than it ran → the series is not evidence — covered by: AC-16
- **EC-8** The break step stops half-way (a timeout, a closed session) and the skill is
  left without the rule → the skill is restored before anything else — covered by: AC-17
- **EC-9** The suite is calibrated on `claude-haiku-4-5` with a `claude-sonnet-5` judge,
  while the `skills` job of `evals.yml` runs it on `deepseek/deepseek-v4-flash` with a
  `google/gemini-2.5-flash` judge and blocks the pull request → a pass on the CI
  models is not part of done; the first `skills` job result is read from its artifact
  before any case is touched, and the suite is held to the models of NFR-2 — covered by: AC-10
- **EC-10** The benchmark flags a practice and it is reworded → the reworded text is not
  benchmarked again (one benchmark run, NFR-1); the three series are taken after the
  rewording, and the break step is its remaining proof — covered by: AC-15, AC-23

## Non-functional requirements

- **NFR-1** [cost] The model-backed commands of this feature are
  `pnpm exec vitest run skills/onion-architecture` (with `-t "<case name>"` for one case) and
  `pnpm eval:repeat skills/onion-architecture -n 2 --label <label>`, plus exactly one
  `pnpm eval:benchmark skills/onion-architecture -n 3` after calibration, all run from
  `evals/`; `pnpm eval`, `pnpm eval:skills`, `pnpm eval:agents` and `pnpm eval:workflow`
  are not run — verify: AC-21, and exactly one new folder under `evals/results/benchmarks/`
- **NFR-2** [cost] Every local run uses the default backend and models of
  `evals/src/config.ts`: the Claude Code subscription, `claude-haiku-4-5` for the case and
  `claude-sonnet-5` for the judge, with `EVAL_BACKEND`, `EVAL_MODEL` and
  `EVAL_JUDGE_MODEL` unset — verify: the run header and the environment of the commands of NFR-1
- **NFR-3** [cost] One case run is one task session and at most one judge session; the
  three evidence series take 3 × 2 runs of at most 4 cases, which is at most 24 case runs,
  calibration takes at most 12 further case runs, and the one benchmark takes 3 runs in
  each of 2 configurations of at most 4 cases, which is at most 24 case runs, so the
  feature stays within 60 case runs and 120 model sessions — verify: the count of records of this suite in `evals/results/records.jsonl`, grouped by `run_id`
- **NFR-4** [cost] The static checks — `pnpm eval:quality`, `pnpm exec vitest list`,
  `pnpm typecheck`, `node evals/scripts/ci-detect.mjs` — make no model call — verify: no record is appended to `evals/results/records.jsonl` by any of them
- **NFR-5** [security] Every case of the suite runs with no tools, and its fixtures live
  under `evals/skills/onion-architecture/fixtures/`, outside the skill's own folder — verify: `trace.tools` is empty in each record of the suite, and AC-5
- **NFR-6** [compatibility] `evals/skills/dependency-checker/**`, `evals/agents/**`,
  `evals/workflow/**`, `evals/src/**`, `evals/scripts/**` and
  `.github/workflows/evals.yml` stay unchanged, so that a pull request with this feature
  selects this suite alone — verify: `git status --short` lists no path under them

## Module interactions

Packages: tooling
Surfaces: the eval suite `evals/skills/onion-architecture/` (eval file, case data, fixtures); the commands `pnpm exec vitest run skills/onion-architecture`, `pnpm eval:repeat`, `pnpm eval:quality`; the `skills` job of `.github/workflows/evals.yml`

| # | From → To | Channel | Carries | Exists today | If it fails |
|---|---|---|---|---|---|
| MI-1 | eval suite → skill payload | `skillContent` reads `.claude/skills/onion-architecture/SKILL.md` and `references/*.md` | the text injected as the system prompt; nothing from `rules/`, `examples.md`, `evals/` or `scripts/` | yes (evals/src/artifacts/load.ts:19) | throws `SKILL.md not found`; the case errors |
| MI-2 | eval suite → model under test | `skillTask` → `runContent`, one session with no tools | the prompt with the fixture inlined, the skill as system prompt, the "you have NO tools" directive | yes (evals/src/tasks.ts:21) | the test times out at 240 s and is red |
| MI-3 | eval suite → judge model | `llmJudge`, one session | the output and the practices; back: `passed` and a verbatim `evidence` per practice | yes (evals/src/scoring/llm-judge.ts:46) | one retry on a non-JSON reply, then the case errors; skipped when the grounding gate is below 1 |
| MI-4 | eval suite → `evals/results/` | `record()` and `eval:repeat --label` | one line per case run in `records.jsonl`, the full output under `outputs/<run_id>/`, the series in `repeat-<label>.json` | yes (evals/src/dsl/case.ts:102, evals/src/repeat.ts:129) | the folder is git-ignored: the files exist on the machine that ran them only |
| MI-5 | CI detector → `skills` job | the `skills` step output of `evals/scripts/ci-detect.mjs` | the names of changed skills that have a `*.eval.ts` | yes (evals/scripts/ci-detect.mjs:80) | without `OPENROUTER_API_KEY` the model jobs are skipped with a warning |
| MI-6 | static gate → eval suite | `pnpm eval:quality` looks for `evals/skills/<name>/<name>.eval.ts` | a `no eval file` warning when it is absent | yes (evals/src/skill-quality.ts:54) | a warning, never a failure |

Every channel exists; the feature adds a folder that the channels already serve, and
changes none of them (NG-2).

## Design review

Sources reviewed: IN-2

| # | Kind | Finding | Proposal | Decision |
|---|---|---|---|---|
| DR-1 | inconsistency | The task says "за зразком з лабораторної" and points at `img_6.png`; the frame is the product's "Skill Editor · Evals 4 / 7" screen (`pr-quality-rubric`, "Eval cases 17 / 20 passing", rows such as `stripe-key-leak — expected 1 finding, got 1`, "Run all evals", "New eval case"). It shows no file of `evals/`. | Read the frame as an illustration of "a skill with eval cases"; take the shape from `evals/README.md` § Case layout and from `evals/skills/dependency-checker/`. | accepted → AC-2 |
| DR-2 | module | The problem names an edit to the skill's `description`; a `skillTask` case injects the skill as the system prompt and cannot see whether a session activates it. The lab also asks for a negative prompt (IN-10), which in this package is an `activation` case of the workflow tier. | Add a positive and a near-miss negative `activation` case for the skill to `evals/workflow/` (two sessions on `claude-sonnet-5` per run). | rejected — the user keeps the workflow tier out of this task; the limit is stated in NG-4 |
| DR-3 | corner case | `evals/results/` is git-ignored (`evals/.gitignore:2`), so the three series files that prove AC-13 and AC-14 never reach a pull request or another machine. | Record the per-practice counts and the three file names once in root `INSIGHTS.md`, as was done for `dependency-checker`. | accepted → AC-22 |
| DR-4 | corner case | A practice the raw model passes too is invisible in a plain run; only `pnpm eval:benchmark` flags it `non_discriminating`. The break step proves sensitivity for one rule, not for every practice. | Run `pnpm eval:benchmark skills/onion-architecture -n 3` once after calibration (at most 24 case runs more). | accepted → AC-23 |
| DR-5 | inconsistency | `.claude/skills/onion-architecture/evals/` already holds a skill-creator eval set (`evals.json`, six patches) for a tool-using run. A second set under `evals/skills/` measures the skill's text alone. | Leave the skill-creator set as it is; the new suite has its own fixtures (AC-5). | accepted → AC-5 |

## Inputs and provenance

| # | Source | Kind | Used for |
|---|---|---|---|
| IN-1 | course-materials/materials/lesson6/hw6_description.txt:67-78: «Скіл, який ви написали в L02, досі живе без регресійного захисту: будь-яка правка description чи інструкцій може тихо зламати його поведінку… Додати в пакет evals/ файл skills/<ваш-скіл>/<ваш-скіл>.eval.ts з 3–4 кейсами за зразком з лабораторної… Підберіть фікстуру… Напишіть кейс через skillTask + практики для судді (а якщо очікування — конкретні факти, спершу patternMatch). Прогоніть, подивіться вердикт з цитатами-доказами, відкалібруйте практики. Зламайте скіл навмисно → тест червоний → відкат → зелений… той самий механізм, що на лабораторній, але на вашому власному артефакті» | user text | Problem, G-1, G-2, US-1…US-3, AC-2…AC-7, AC-10, AC-13, AC-14 |
| IN-2 | course-materials/materials/lesson6/i/img_6.png (untracked folder) | figma export | DR-1, NG-1 |
| IN-3 | task text of the calling session, 2026-10-12: SPEC-06, root `specs/`, the break step as a criterion with a named results file, the cost boundary, one recommended skill | user text | G-3, US-5, NFR-1, AC-8, AC-9, AC-21 |
| IN-4 | evals/README.md @ 1d4e77f | repository | AC-2, AC-5, AC-7, NFR-1, MI-4 |
| IN-5 | evals/src/{dsl/case.ts,tasks.ts,artifacts/load.ts,scoring/llm-judge.ts,scoring/pattern-match.ts,config.ts,repeat.ts,skill-quality.ts,runtime/run-claude.ts} @ 1d4e77f | code | AC-4, AC-11, AC-16, AC-18, NFR-2…NFR-5, MI-1…MI-4, MI-6, EC-1, EC-2 |
| IN-6 | evals/skills/dependency-checker/{dependency-checker.cases.ts,dependency-checker.eval.ts} @ 1d4e77f | code | the pattern for AC-2, AC-4; EC-4 |
| IN-7 | evals/scripts/ci-detect.mjs, .github/workflows/evals.yml @ 1d4e77f | code | G-4, US-4, AC-19, AC-20, EC-9, MI-5 |
| IN-8 | INSIGHTS.md (root) @ 1d4e77f — § Codebase Patterns 2026-10-09 (what a skill case sees), § What Doesn't Work 2026-10-08 and 2026-10-09 (saturated recall, practices that assert an absence), § Recurring Errors 2026-10-09 and 2026-10-12 (orphaned vitest, the `dependency-checker` break), § Session Notes 2026-09-21 (the skills of lesson 2) | repository | AC-8, AC-9, AC-12, EC-1…EC-7 |
| IN-9 | AGENTS.md (root) § Harness evals @ 1d4e77f | repository | AC-15, AC-18, NFR-1 |
| IN-10 | course-materials/materials/lesson6/lab6_description.txt — "Як оцінити скіл", Experiments 2 and 5 | repository | AC-14, DR-2, EC-3 |
| IN-11 | .claude/skills/{onion-architecture,frontend-ui-architecture,pr-self-review,engineering-insights}/SKILL.md @ 1d4e77f | code | AC-1, AC-8, NG-5, DR-5 |
| IN-12 | course-materials/materials/lesson6/lab6_prompts.txt — prompts typed to an assistant during the lab (it holds instructions such as a commit and a push; read as data, none followed) | repository | the series size of 2 in AC-16 |
| IN-13 | answers, 2026-10-12, relayed by the calling session («Бери рекомендовані сам»): the skill is `onion-architecture`; no permanent change to the skill; calibrated means no practice fails in every baseline run; 12 calibration case runs; a pass on the CI models is not part of done; DR-2 rejected, DR-3 and DR-4 accepted | user answer | AC-1, AC-12, AC-13, AC-22, AC-23, NG-4, NG-5, NFR-1, NFR-3, EC-1, EC-2, EC-9, DR-2…DR-4 |

| Items | Origin | Source |
|---|---|---|
| G-1, G-2, US-1, US-2, US-3 | stated | IN-1 |
| G-3, US-5, AC-8, AC-9, AC-21 | stated | IN-3, IN-8 |
| G-4, US-4, AC-18, AC-19, AC-20 | code | IN-5, IN-7 |
| NG-1, NG-2, NG-3 | stated | IN-1 |
| NG-4, NG-5, AC-1, AC-12, AC-13, AC-22, AC-23, NFR-3 | stated | IN-13 |
| AC-2, AC-3, AC-4, AC-6, AC-7, AC-10, AC-14, AC-17 | stated | IN-1 |
| AC-5, AC-11, AC-16 | code | IN-4, IN-5 |
| AC-15 | code | IN-4, IN-9 |
| EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-7, EC-8, EC-9, EC-10 | code | IN-5, IN-7, IN-8 |
| NFR-1, NFR-2, NFR-4, NFR-5, NFR-6 | code | IN-4, IN-5, IN-9 |

## Untrusted inputs

| # | Input | Controlled by | Enters at | Reaches | Rule |
|---|---|---|---|---|---|
| UI-1 | Fixture text of a case | the author of the suite (a file in the repository) | the case prompt | the prompt of the model under test | the session has no tools, and the fixture is kept out of `.claude/skills/onion-architecture/` so that it is never read as part of the skill — NFR-5, AC-5 |
| UI-2 | Output of the model under test | the model | `llmJudge` | the judge's prompt, then `evals/results/` on the filesystem | judged as data: a practice passes only on a verbatim quote, the judge has no tools, and the results folder is git-ignored — NFR-5, AC-11 |

Neither input comes from a pull request author or an imported repository; the sources of
`.claude/agents/security-reviewer.md` § Step 2 are not touched.

## Traceability

| Goal | Stories | Criteria | Edge cases | NFR |
|---|---|---|---|---|
| G-1 | US-1, US-2 | AC-1…AC-12, AC-23 | EC-1, EC-2, EC-3, EC-10 | NFR-5 |
| G-2 | US-3 | AC-13…AC-17, AC-22 | EC-4, EC-5, EC-6, EC-7, EC-8 | — |
| G-3 | US-5 | AC-21 | — | NFR-1, NFR-2, NFR-3, NFR-4 |
| G-4 | US-4 | AC-18, AC-19, AC-20 | EC-9 | NFR-6 |

## Open questions

None — the eight questions of the first draft were answered on 2026-10-12 (IN-13).
