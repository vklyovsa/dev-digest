# Implementation Plan — Own skill eval (SPEC-06)
Source: specs/2026-10-12-own-skill-eval.md · Base: 1d4e77f · Packages: evals (tooling)

`check-spec.sh`: `ok … SPEC-06 · approved … OQ 0 (blocking 0)`, plus one WARN that AC-9…AC-14 are `verify: manual` (each states its reason).

## 0. Before the first edit
- INSIGHTS: `INSIGHTS.md § Codebase Patterns` — "A skill quality eval in `evals/` sees only `SKILL.md` plus `references/*.md`, with no tools" → `.claude/skills/onion-architecture/` has no `references/` folder (only a `references.md` file, which is not read), so the payload is `SKILL.md` alone. Every practice, gate literal and the broken rule come from `SKILL.md`.
- INSIGHTS: `§ What Doesn't Work` — "A 'find the seeded layering violation' eval does not separate the skill from no skill on Sonnet" and "Making the seeded violations harder did not separate two versions" → no practice measures detection; each one names an `OA-n` ID, a report heading or a file path that only the skill states.
- INSIGHTS: `§ What Doesn't Work` — "A practice that asserts an absence … measures the judge" → practices are positive and quotable (AC-9).
- INSIGHTS: `§ Recurring Errors & Fixes` — "Corrected 2026-10-12: the zod-drift practice…" (the `dependency-checker` break moved a practice 2/2 → 0/2 inside a passing case) → the case tied to the broken rule has one practice and `threshold: 1`. Its two wording traps apply: name the format, and ask for a column rather than for every row.
- INSIGHTS: `§ Recurring Errors & Fixes` — "A benchmark summary counts one case twice … orphaned vitest" → the process check before every model command (stage 3 preamble).
- INSIGHTS: `§ Tool & Library Notes` — pnpm 12 `ERR_PNPM_IGNORED_BUILDS` → static checks run through `evals/node_modules/.bin/<tool>`. The tracked `evals/pnpm-workspace.yaml` (`allowBuilds: esbuild`) is what lets `pnpm exec` and `pnpm eval:*` work in `evals/`.
- INSIGHTS: `§ Tool & Library Notes` — "`settingSources` does not keep the developer's own context out" → already handled by `NO_PERSONAL_CONTEXT` (`evals/src/runtime/run-claude.ts:17-20`); nothing to do.
- INSIGHTS: `§ What Works` — "An agent written for Sonnet fails its own format rules on Haiku" → Haiku may write analysis before the report; practices say "a Must fix row cites…", never "the reply opens with…".
- INSIGHTS: `§ Session Notes 2026-10-11` — `eval:repeat` is capped at 2 (`EVAL_REPEAT_MAX`) → `-n 2` fits; the variable stays unset.
- Read: `specs/2026-10-12-own-skill-eval.md`, `evals/README.md` § Case layout, § `eval:repeat`, § `eval:benchmark`, § Records. `evals/` has no `AGENTS.md` and no `INSIGHTS.md`.

## 1. Scope — as the source states it
Goal — `specs/2026-10-12-own-skill-eval.md:20-27`:
- G-1 The chosen skill has a suite of 3 to 4 model-backed cases in the `evals/` package that passes on the skill as it is today.
- G-2 The suite is shown to detect a regression: with one rule taken out of the skill it is red, with the rule back it is green, and both results are recorded.
- G-3 The model-backed runs the work needs are named and bounded before any of them starts.
- G-4 A later edit to the skill gets the suite run: the static gate stops warning, and the CI detector picks the suite instead of logging a skip.

Non-goals — `:28-40`:
- NG-1 The product's Skill Editor · Evals tab.
- NG-2 A change to the eval engine (`evals/src/**`), to `evals/scripts/ci-detect.mjs` or to `.github/workflows/evals.yml`.
- NG-3 Suites for the user's other skills.
- NG-4 An activation (triggering) case for the skill in the workflow tier.
- NG-5 A permanent change to the content of `.claude/skills/onion-architecture/` — the only edit is the temporary one of the break step.

Acceptance criteria (source wording, cut):
- AC-1 The eval suite shall cover the skill `onion-architecture` — `:58` — clear
- AC-2 … collected from `evals/skills/onion-architecture/onion-architecture.eval.ts` — `:59-60` — clear
- AC-3 … at least 3 and at most 4 cases — `:61` — clear
- AC-4 … run every case through `skillTask` with the skill's content as the system prompt — `:62-63` — clear
- AC-5 … inline each case's fixture into the prompt from `evals/skills/onion-architecture/fixtures/` — `:64-65` — clear
- AC-6 … give every case at least one practice for the judge — `:66-67` — clear
- AC-7 WHERE a case expects a literal string in the output, … check that string through the case's `grounding` gate before the judge runs — `:68-69` — clear
- AC-8 … name in every practice an identifier, a heading or a format that the skill's `SKILL.md` or `references/*.md` states — `:70-71` — clear
- AC-9 … word every practice as a positive statement that one verbatim quote from the output proves — `:72-73` — clear
- AC-10 WHEN `pnpm exec vitest run skills/onion-architecture` runs against the unmodified skill on the models of NFR-2, … pass every case — `:74-75` — clear
- AC-11 WHEN a case finishes, … append a record to `evals/results/records.jsonl` that holds `passed` and `evidence` for each practice — `:76-77` — already there in the engine (`evals/src/dsl/case.ts:102`, `evals/src/records/record.ts:76`); holds once a run exists
- AC-12 WHEN the baseline series is recorded, … no practice that failed in every run of that series — `:78-79` — clear
- AC-13 WHEN one rule that the skill states is removed from the skill and the suite is run as a labelled series, … record `outcome: false` for the case tied to that rule in every run of the series — `:80-82` — clear
- AC-14 WHEN the removed rule is restored and the suite is run as a labelled series, … pass every case in every run of the series — `:83-84` — clear
- AC-15 … keep the same case names and the same practice texts across the three labelled series: full, broken and restored — `:85-86` — clear
- AC-16 … exactly 2 runs of every case in each labelled series — `:87-88` — clear
- AC-17 WHEN the restored series is recorded, the working tree shall show `.claude/skills/onion-architecture/` identical to its state before the break — `:89-90` — clear
- AC-18 WHEN `pnpm eval:quality` runs, the static gate shall report the chosen skill without the `no eval file` warning — `:91-92` — clear
- AC-19 WHEN the changed-file list holds a path under `.claude/skills/onion-architecture/` or under `evals/skills/onion-architecture/`, the CI detector shall emit the skill in its `skills` output — `:93-95` — clear (mechanism at `evals/scripts/ci-detect.mjs:80`)
- AC-20 WHEN `pnpm typecheck` runs in `evals/`, the evals package shall report no error — `:96-97` — clear
- AC-21 The records written to `evals/results/records.jsonl` while the feature is built shall name no suite other than `skills/onion-architecture` — `:98-99` — clear; depends on question 3
- AC-22 WHEN the restored series is recorded, the root `INSIGHTS.md` shall hold one entry that names the three series files and the per-practice pass counts of each — `:100-102` — clear
- AC-23 WHEN `pnpm eval:benchmark skills/onion-architecture -n 3` finishes, … keep no practice that the benchmark report flags `non_discriminating` — `:103-105` — clear

Non-functional (the cost caps) — `:144-166`:
- NFR-1 the model-backed commands are `pnpm exec vitest run skills/onion-architecture` (with `-t`), `pnpm eval:repeat skills/onion-architecture -n 2 --label <label>`, plus exactly one `pnpm eval:benchmark skills/onion-architecture -n 3`.
- NFR-2 default backend and models, `EVAL_BACKEND`, `EVAL_MODEL` and `EVAL_JUDGE_MODEL` unset.
- NFR-3 calibration at most 12 further case runs; the feature stays within 60 case runs and 120 model sessions.
- NFR-4 the static checks make no model call.
- NFR-5 every case runs with no tools.
- NFR-6 `evals/skills/dependency-checker/**`, `evals/agents/**`, `evals/workflow/**`, `evals/src/**`, `evals/scripts/**` and `.github/workflows/evals.yml` stay unchanged.

## 2. Impact map
| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| evals | `evals/skills/onion-architecture/onion-architecture.eval.ts` | New | thin eval file (`evals/README.md` § Case layout) | AC-1, AC-2, AC-4, AC-18, AC-19 |
| evals | `evals/skills/onion-architecture/onion-architecture.cases.ts` | New | case data | AC-3, AC-5…AC-9, AC-15 |
| evals | `evals/skills/onion-architecture/fixtures/reminders-service.ts` | New | fixture, case A | AC-5, AC-13 |
| evals | `evals/skills/onion-architecture/fixtures/pulls-routes.ts` | New | fixture, case B | AC-5 |
| evals | `evals/skills/onion-architecture/fixtures/digests-service.ts` | New | fixture, case C | AC-5 |
| root | `INSIGHTS.md` | Modify (one entry, § What Works) | cross-cutting learning | AC-22 |
| harness | `.claude/skills/onion-architecture/SKILL.md` | temporary edit, restored byte-identical in stage 5 | — | AC-13, AC-17 |
| evals | `evals/results/**` (git-ignored: `records.jsonl`, `outputs/`, `repeat-onion-architecture-{full,broken,restored}.json`, one `benchmarks/<timestamp>/`, the pre-break backup) | written by the commands | evidence | AC-11…AC-16, AC-21, AC-23 |

Not touched: `server/`, `client/`, `reviewer-core/`, `mcp/`, `e2e/`, `.claude/agents/**`, `.claude/settings*.json`, any other skill, and every path in NFR-6.

## 3. Constraints in play
- NFR-6 and NG-2: no edit under `evals/src/**`, `evals/scripts/**`, `evals/agents/**`, `evals/workflow/**`, `evals/skills/dependency-checker/**`, `.github/workflows/evals.yml`. If a command fails for an engine reason, that is a blocker to report, not something to fix here.
- No dependency-cruiser config in `evals/`. The typecheck is `tsc --noEmit` with `**/fixtures/**` excluded (`evals/tsconfig.json:14-15`), so fixture `.ts` files may import `fastify` or `drizzle-orm` without resolving.
- Naming: `<skill>.eval.ts`, `<skill>.cases.ts`, kebab-case fixtures; imports from the barrel `../../src/index.js` only (`evals/src/index.ts:1-5`).
- No new dependency; `evals/pnpm-lock.yaml` and `evals/package.json` are untouched.
- No file is added under `.claude/skills/onion-architecture/` (AC-5): the pre-break backup lives in `evals/results/`.
- No git state change: the restore is a file copy, never `git checkout` / `git restore` / `git stash`.
- Skill routing: `route-skills.sh` on the four planned paths returns `lanes: []`, all `unrouted`. No project skill governs `evals/**`; the conventions are root `AGENTS.md` § Naming conventions and `evals/README.md` § Case layout.

## 4. Stages

### Stage 1 — The suite: eval file, case data, three fixtures
Track: suite · After: — · Executor: per question 2 (recommended: the calling session). No model call.
Files: `evals/skills/onion-architecture/onion-architecture.eval.ts`, `onion-architecture.cases.ts`, `fixtures/reminders-service.ts`, `fixtures/pulls-routes.ts`, `fixtures/digests-service.ts` (all New)
Read first:
- `evals/skills/dependency-checker/dependency-checker.eval.ts` — the four-line eval file to copy.
- `evals/agents/architecture-reviewer/architecture-reviewer.cases.ts:1-45` — the `fixtureReader(import.meta.url)` pattern and quotable-practice wording.
- `evals/src/dsl/case.ts:22-36,82-113` — the `SkillCase` fields; gate first, then judge, then threshold.
- `.claude/skills/onion-architecture/SKILL.md:92-139` — the only text the model under test receives beyond the prompt.

Steps:
1. `onion-architecture.eval.ts` — the same shape as the `dependency-checker` one: `describeSkill("onion-architecture", () => runSkillCases("onion-architecture", cases));`, importing `cases` from `./onion-architecture.cases.js`. No other runner (AC-4).
2. `fixtures/reminders-service.ts` (case A — the case tied to the rule that stage 5 removes). Content, with no comments:
   - an exported `Reminder` interface (`id`, `pullId`, `note`);
   - an exported `RemindersRepositoryPort` interface with `findById(id): Promise<Reminder | null>` and `markDone(id): Promise<void>`;
   - `RemindersService`, whose constructor takes `private readonly reminders: RemindersRepositoryPort` and whose `complete(id)` calls `findById`, then on `null` executes exactly one `throw new Error(\`Reminder ${id} not found\`)`, then `markDone`, and returns the reminder.
   - Must not contain: `AppError`, `NotFoundError`, `drizzle`, `fastify`, `Container`, `new Date`, `process.env`, a second `throw`.
3. `fixtures/pulls-routes.ts` (case B). A Fastify plugin `pullsRoutes(app, container)` that:
   - imports `eq` from `"drizzle-orm"`, `pullRequests` from `"../../db/schema.js"` and the `Container` type;
   - registers `GET /pulls/:id`, which returns `container.pullsService.get(id)` — the correct route;
   - registers `POST /pulls/:id/refresh`, which calls `container.github()`, reads the pull through it, and writes with `container.db.update(pullRequests).set(...).where(eq(pullRequests.id, id))`.
   - Must not contain: `throw`, `reply.status(`, `reply.code(` — the break of OA-10 must leave this case untouched.
4. `fixtures/digests-service.ts` (case C). A `DigestsService` whose constructor takes a named `DigestsRepositoryPort` and whose `publish(digestId)` marks the digest published and returns it. Nothing about Slack or notifications. Must not contain: `throw`, `adapters`, `mocks`, `container`.
5. `onion-architecture.cases.ts` — exactly this data. Three cases, not four: at 3 cases the worst case is 12 + 18 + 18 = 48 runs, at 4 it is the full 60 with no room for anything.

```ts
import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const file = (path: string, fixture: string) => `File: ${path}\n\`\`\`ts\n${fx(fixture)}\n\`\`\``;

const NO_FILES =
  "The rules/*.md files, examples.md and the repository cannot be opened in this session. " +
  "Everything needed is in this message: answer now from what you already know, and do not ask for a file.";

export const cases: SkillCase[] = [
  {
    name: "review cites OA-10 for a plain Error thrown by a use case",
    kind: "quality",
    prompt: `Review this new file for layering before it is merged.\n\n${file("server/src/modules/reminders/service.ts", "reminders-service.ts")}\n\n${NO_FILES}`,
    grounding: ["Verdict:"],
    practices: ["a Must fix row cites `OA-10` for the `throw new Error` in server/src/modules/reminders/service.ts"],
    threshold: 1,
  },
  {
    name: "review report has a Must fix table, a Fine as is list and a Verdict line",
    kind: "quality",
    prompt: `Review this change to the pulls routes for layering before it is merged.\n\n${file("server/src/modules/pulls/routes.ts", "pulls-routes.ts")}\n\n${NO_FILES}`,
    grounding: ["Must fix", "Fine as is", "Verdict: BLOCK"],
    practices: [
      "a Must fix row cites `OA-1` for the `drizzle-orm` import in server/src/modules/pulls/routes.ts",
      "a Must fix row cites `OA-2` for the `container.github()` call in the refresh route",
      "the Fine as is list names the GET route that calls one service method",
      "the review ends with a line of the form `Verdict: BLOCK — <n> must-fix`, with a number in place of <n>",
    ],
    threshold: 0.75,
  },
  {
    name: "new external capability is placed on the port, adapter, mock and container files",
    kind: "quality",
    prompt: `This use case must also post the published digest to a Slack channel. Slack is a new external capability for the backend. List every file you would create or change, in the order you would build them, with one line on what goes into each. Do not write the code.\n\n${file("server/src/modules/digests/service.ts", "digests-service.ts")}\n\n${NO_FILES}`,
    grounding: ["vendor/shared/adapters.ts", "src/adapters/mocks.ts"],
    practices: [
      "the port for Slack is declared in `vendor/shared/adapters.ts` at an earlier step than the adapter that implements it",
      "the adapter class for Slack is placed under `src/adapters/`",
      "the Slack adapter is constructed in `platform/container.ts`",
    ],
    threshold: 0.6,
  },
];
```

6. One comment only, above case A, stating the invariant: its gate holds only `Verdict:` and its threshold is 1, so that with OA-10 removed the judge still runs, the practice is recorded as failed, and the case outcome itself is false (EC-4).
7. Wording rules that calibration (stage 3) must keep:
   - backticks in a practice are reserved for strings that `grep -F` finds in `SKILL.md` (AC-8); fixture paths are written without backticks;
   - a prompt never names an identifier that a practice or a gate checks;
   - `OA-10` appears in case A only.

Skills: none — `routing.md` has no row for `evals/**` (`route-skills.sh`: `lanes: []`).
Tests to add: none — the suite is the test; its model-backed run is stage 3.
Done when: the five files exist and stage 2 is green.

### Stage 2 — Static gate (no model) and the start marker
Track: suite · After: 1 · Executor: the calling session (or the same brief as stage 1). No model call (NFR-4).
Files: none written.
Read first: `evals/src/skill-quality.ts:54-55`, `evals/scripts/ci-detect.mjs:73-85,99-106`.
Steps:
1. Record the start marker: `wc -l < evals/results/records.jsonl` → `L0` (214 at the time of planning). Keep the number; every count in stages 3–6 is "records after `L0`". If question 3 was answered "window", confirm the window is open before recording it.
2. `cd evals && ./node_modules/.bin/tsc --noEmit` → exit 0 (AC-20).
3. `cd evals && ./node_modules/.bin/vitest list skills/onion-architecture` → exactly three lines, each `skills/onion-architecture/onion-architecture.eval.ts > skill:onion-architecture > <case name>` (AC-1, AC-2, AC-3).
4. `cd evals && ./node_modules/.bin/tsx src/skill-quality.ts` (the body of `pnpm eval:quality`) → the `onion-architecture` block carries no `no eval file` line (AC-18). The exit code reflects all skills; read this skill's block.
5. From the repository root (AC-19), each must print `skills=["onion-architecture"]`, `run_workflow=false` and an empty `skipped_skills=`:
   - `CHANGED_FILES=.claude/skills/onion-architecture/SKILL.md node evals/scripts/ci-detect.mjs`
   - `CHANGED_FILES=evals/skills/onion-architecture/onion-architecture.cases.ts node evals/scripts/ci-detect.mjs`
6. AC-8: for each of `OA-10`, `throw new Error`, `OA-1`, `drizzle-orm`, `OA-2`, `container.github()`, `Verdict: BLOCK — <n> must-fix`, `vendor/shared/adapters.ts`, `src/adapters/`, `platform/container.ts`, `src/adapters/mocks.ts`, `Must fix`, `Fine as is`, run `grep -cF -- '<string>' .claude/skills/onion-architecture/SKILL.md` → 1 or more each.
7. AC-9 (manual): read the eight practices; none asserts an absence.
8. AC-5 / NFR-6: `git status --short -- evals .claude/skills` lists only `?? evals/skills/onion-architecture/`.
9. NFR-4: `wc -l < evals/results/records.jsonl` still equals `L0`.

Skills: none.
Done when: steps 2–9 hold. A failure in steps 2–3 is fixed in stage 1's files; a failure in steps 4–5 that needs an engine change is a blocker (NG-2).

### Preamble for stages 3–5 — every model-backed command
Run by the **calling session**, never by an agent. All commands run from `evals/`.
- Prefix (NFR-2): `env -u EVAL_BACKEND -u EVAL_MODEL -u EVAL_JUDGE_MODEL -u EVAL_CONFIG -u EVAL_REPEAT_MAX -u EVAL_MAX_TURNS` — written `$CLEAN` below.
- Before each command:
  1. `ps -eo pid,etime,cmd | grep -E "vitest|src/repeat.ts|src/records/benchmark.ts" | grep -v grep` prints nothing. If it prints something, wait until it exits; never start over it (EC-7).
  2. Budget: `used` = records of this suite after `L0` (script in section 6). Continue only if `used + cost ≤ 60`. Costs: a full run 3, a `-t` run 1, the benchmark 18, a series 6.
- A series or the benchmark takes longer than a foreground Bash call allows: start it in the background and wait for its exit. Do not kill it; if it must be killed, kill the `vitest run` child too and wait for the process list to be empty.
- If `pnpm <script>` exits with `ERR_PNPM_IGNORED_BUILDS` before doing anything, run the script body instead (`./node_modules/.bin/tsx src/repeat.ts …`, `./node_modules/.bin/tsx src/records/benchmark.ts …`). If the child prints `no records — run crashed`, stop and report: no engine edit (NG-2).
- After each command, run the records script: `other suites` must be 0 (AC-21) and `with tools` must be 0 (NFR-5); otherwise stop.

### Stage 3 — Calibration on the unmodified skill (paid, at most 12 case runs)
Track: suite · After: 2 · Executor: the calling session.
Files: `evals/skills/onion-architecture/onion-architecture.cases.ts` (Modify, wording only); fixtures only if an output shows a fixture defect.
Read first: the newest `evals/results/outputs/<run_id>/*.md` and the matching lines of `evals/results/records.jsonl` after each run.
Steps:
1. First run (3 case runs): `$CLEAN pnpm exec vitest run skills/onion-architecture`.
2. For every practice with `passed: false`, read its `evidence` and the saved output before changing anything. Then:
   - the output asks for a file or says it cannot read `rules/…` (EC-2) → strengthen `NO_FILES` in the prompt; the skill is not edited (NG-5);
   - the output meets the practice in other words → reword the practice to what is quotable, keeping an identifier from `SKILL.md` in it;
   - a gate literal is missing while the report is otherwise right → correct the gate literal to what `SKILL.md` states; never delete the gate;
   - case A fails → fix the prompt or the practice wording. Its threshold stays 1 and it keeps a single practice.
3. Re-run only the changed case (1 case run each): `$CLEAN pnpm exec vitest run skills/onion-architecture -t "<case name>"`.
4. Closing run (3 case runs) after the last rewording: `$CLEAN pnpm exec vitest run skills/onion-architecture` → `3 passed`. This summary is the AC-10 evidence; its three records, each with `practices[].passed` and `evidence`, are the AC-11 evidence. If step 1 was already 3/3 with nothing to reword, step 1 is this run.
5. Re-run stage 2 steps 2, 3 and 6 after any edit (free).

Stop conditions:
- 12 calibration case runs spent without a 3/3 closing run → stop and report to the user with the failing evidence quotes.
- Planned use is 3 + up to 3 + 3 = 9; the remaining 3 are held for stage 4 step 3.

Skills: none.
Done when: one full run on the final wording is 3/3; calibration records are 12 or fewer; `git status --short -- .claude/skills` is empty.

### Stage 4 — The one benchmark (paid, 18 case runs)
Track: suite · After: 3 · Executor: the calling session.
Files: `onion-architecture.cases.ts` (Modify, only if a practice is flagged).
Read first: `evals/results/benchmarks/<new timestamp>/benchmark.md` § Per-practice matrix and § Flags.
Steps:
1. Once, and only once (NFR-1): `$CLEAN pnpm eval:benchmark skills/onion-architecture -n 3`. Expect the header `3 test case(s) × 3 runs × 2 configs = 18 sessions`.
2. Read § Flags:
   - `non_discriminating` on a practice → remove it, or reword it to an identifier only the skill states (AC-23). A case keeps at least one practice (AC-6); case A keeps exactly one.
   - `missing_data` on baseline practices is expected: the gate failed without the skill and the judge was skipped (`evals/README.md` § Statistics semantics). It is not a defect and needs no change.
   - `flaky` or `always_failing` on the candidate side → treat as a stage 3 calibration item, within the remaining calibration runs.
3. If any practice text changed: one closing run `$CLEAN pnpm exec vitest run skills/onion-architecture` → 3/3 (from the calibration reserve), which replaces stage 3's AC-10 evidence. The reworded text is not benchmarked again (EC-10).
4. From here on, case names and practice texts are frozen (AC-15, EC-6).

Stop conditions:
- The benchmark crashed or was interrupted → do not start a second one; report to the user.
- More than one new folder under `evals/results/benchmarks/` → report it.

Skills: none.
Done when: exactly one new `evals/results/benchmarks/<timestamp>/` exists; no practice in the case data is flagged `non_discriminating` in its `benchmark.md`.

### Stage 5 — Evidence: full → break → broken → restore → restored (paid, 18 case runs)
Track: suite · After: 4 · Executor: the calling session, in one sitting, inside the window of question 3.
Files: `.claude/skills/onion-architecture/SKILL.md` (temporary edit, then restored); `evals/results/repeat-onion-architecture-{full,broken,restored}.json` (written by the commands).
Read first: `.claude/skills/onion-architecture/SKILL.md:116-121` — the OA-10 item is lines 118–120.
Steps, in this order:
1. Baseline: `$CLEAN pnpm eval:repeat skills/onion-architecture -n 2 --label onion-architecture-full`.
   - Expect `3 test case(s) × 2 runs`, both runs `✓ 3/3 cases`, and `Saved as 'onion-architecture-full'`.
   - AC-12: no practice shows `0/2`.
   - A red case here → return to stage 3 if calibration runs remain, otherwise stop.
2. Before the break, from the repository root:
   - `git diff --stat -- .claude/skills/onion-architecture` → prints nothing; keep that as the "before" state.
   - `sha256sum .claude/skills/onion-architecture/SKILL.md` → keep as `PRE`.
   - `cp .claude/skills/onion-architecture/SKILL.md evals/results/onion-architecture-SKILL.pre-break.md`.
3. Break: with the Edit tool, delete exactly the three lines of the OA-10 checklist item (118–120: from `- [ ] **OA-10** A use case fails with an \`AppError\`` through `See \`rules/errors.md\`.`). Nothing else changes.
   - Check: `grep -c "OA-10" .claude/skills/onion-architecture/SKILL.md` → 0.
   - Check: `git diff --stat -- .claude/skills/onion-architecture` → one file, 3 deletions.
4. Broken series: `$CLEAN pnpm eval:repeat skills/onion-architecture -n 2 --label onion-architecture-broken`.
5. Restore — the first action after step 4 returns, whatever it printed, and the first action after any interruption (EC-8):
   - `cp evals/results/onion-architecture-SKILL.pre-break.md .claude/skills/onion-architecture/SKILL.md`.
   - `sha256sum` equals `PRE`, and `git diff --stat -- .claude/skills/onion-architecture` prints nothing, as before the break (AC-17).
   - If the backup is gone: `git show HEAD:.claude/skills/onion-architecture/SKILL.md` holds the same bytes, because step 2 showed no diff.
6. Read the broken result:
   - Case A must be `0/2` (AC-13) with its practice `0/2`.
   - Cases B and C are expected to stay `2/2`; their result does not decide AC-13.
7. Restored series: `$CLEAN pnpm eval:repeat skills/onion-architecture -n 2 --label onion-architecture-restored` → both runs `✓ 3/3 cases` (AC-14).
8. Final check of AC-17 after the series is saved: the two commands of step 5 again.

Stop conditions:
- Case A is `1/2` or `2/2` in the broken series, or any case is below `2/2` in the restored series (EC-5) → not evidence. The skill is already restored. Retaking all three series costs 18 case runs: do it only if `used + 18 ≤ 60` after recalibrating case A within the calibration reserve; otherwise stop and report to the user (see REC1).
- Any series shows a test with `total` other than 2 (an orphan or a foreign record, EC-7) → that series is not evidence; same rule.
- Never leave this stage, start another task or answer another request while `grep -c "OA-10" …/SKILL.md` is 0.

Skills: none.
Done when: the three `repeat-onion-architecture-*.json` files exist, the series script of section 6 reads as AC-12…AC-16 require, and `SKILL.md` is byte-identical to `PRE`.

### Stage 6 — Close: counts, the INSIGHTS entry, final static pass
Track: suite · After: 5 · Executor: the calling session. No model call.
Files: `INSIGHTS.md` (root, Modify — one entry).
Read first: `INSIGHTS.md:15-20` (§ What Works, the entry format) and `INSIGHTS.md:183-184` (the `dependency-checker` break entry, the model for this one).
Steps:
1. Run both scripts of section 6 and keep their output:
   - series script: `times=2` in each file; every test `x/2`; identical case names and practice lines in the three files (AC-15, AC-16);
   - records script: `other suites: 0` (AC-21), `this suite ≤ 60` (NFR-3), `with tools: 0` (NFR-5).
2. `ls evals/results/benchmarks/` shows exactly one folder newer than `L0`'s time (NFR-1).
3. Add one entry at the top of root `INSIGHTS.md` § What Works (newest first, dated 2026-10-12, 1–3 lines plus a `→` line), through the `engineering-insights` skill or by a direct edit. Re-read the file immediately before editing: other sessions append to it. The entry names (AC-22):
   - the three files `evals/results/repeat-onion-architecture-{full,broken,restored}.json`;
   - the per-practice pass counts of each series, as printed by the series script;
   - the rule removed (OA-10, `SKILL.md:118-120`) and the benchmark folder;
   - if a retake happened, that fact.
4. Re-run stage 2 steps 2–5 and 8. `git status --short` must show only `evals/skills/onion-architecture/`, `INSIGHTS.md` and the spec/plan files for this feature; nothing under the NFR-6 paths or `.claude/skills/`.
5. Saving this plan beside the spec (and its link in `specs/README.md`, which another spec on this branch also edits) is the calling session's bookkeeping, not a stage.

Skills: none (`engineering-insights` is a process skill).
Done when: every row of section 6 holds and the `INSIGHTS.md` counts match the three files.

## 5. Skills matrix
| Stage | project skill |
|---|---|
| 1–6 | none — `evals/**`, root `INSIGHTS.md` and `.claude/**` route to no skill lane (`.claude/skills/pr-self-review/rules/routing.md:27`; `route-skills.sh` → `lanes: []`) |

## 6. Verification
| Package | Command (from the repository root unless it starts with `cd`) | Proves |
|---|---|---|
| evals | `cd evals && ./node_modules/.bin/tsc --noEmit` | AC-20 |
| evals | `cd evals && ./node_modules/.bin/vitest list skills/onion-architecture` | AC-1, AC-2, AC-3 — three tests, no model call |
| evals | `cd evals && ./node_modules/.bin/tsx src/skill-quality.ts` | AC-18 |
| evals | the two `CHANGED_FILES=… node evals/scripts/ci-detect.mjs` calls of stage 2 step 5 | AC-19 |
| evals | the `grep -cF` list of stage 2 step 6; a reading of the practices | AC-8, AC-9, AC-4, AC-6, AC-7 |
| evals | vitest summary of the closing `pnpm exec vitest run skills/onion-architecture` and its three records | AC-10, AC-11 |
| evals | `benchmark.md` § Flags of the single new benchmark folder | AC-23, NFR-1 |
| evals | series script (below) | AC-12, AC-13, AC-14, AC-15, AC-16 |
| evals | records script (below) with `L0` | AC-21, NFR-3, NFR-5 |
| harness | `git diff --stat -- .claude/skills/onion-architecture` and `sha256sum` against `PRE` | AC-17, NG-5 |
| root | a reading of the `INSIGHTS.md` entry against the series script output | AC-22 |
| all | `git status --short` | AC-5, NFR-6 |

`check-code.sh` is not in this table: it has no `evals` lane (REC2).

Series script:
```bash
node -e '
const fs=require("fs");
for(const l of ["full","broken","restored"]){
  const d=JSON.parse(fs.readFileSync("evals/results/repeat-onion-architecture-"+l+".json","utf8"));
  console.log("\n"+l+" times="+d.times);
  for(const t of Object.values(d.tests)){
    console.log("  "+t.pass.passed+"/"+t.pass.total+"  "+t.label);
    for(const [p,s] of Object.entries(t.practices)) console.log("      "+s.passed+"/"+s.total+"  "+p);
  }
}'
```

Records script (replace `214` with the recorded `L0`):
```bash
node -e '
const fs=require("fs");const L0=Number(process.argv[1]);
const rows=fs.readFileSync("evals/results/records.jsonl","utf8").split("\n").filter(Boolean).slice(L0).map(l=>JSON.parse(l));
const mine=rows.filter(r=>r.nodeid.includes("/evals/skills/onion-architecture/"));
const by={};for(const r of mine){const k=r.run_id+" "+r.config;by[k]=(by[k]||0)+1}
console.log("since L0:",rows.length,"| this suite:",mine.length,"| other suites:",rows.length-mine.length);
console.log("with tools:",mine.filter(r=>r.trace.tools.length).length,"| judged:",mine.filter(r=>r.practices.length).length);
console.table(by);' 214
```

## 7. Risks and open questions
- [blocking] Execution mode — options: single-agent (recommended) / multi-agent (question 1).
- [blocking] Executor of stages 1–2 — options: the calling session (recommended) / one `implementer` brief (question 2).
- [blocking] The window for stages 3–5 against the parallel work on this branch — options: a confirmed window (recommended) / run regardless (question 3).
- [non-blocking] One retake fits the cap only if calibration stays frugal. Worst case without a retake is 12 + 18 + 18 = 48 case runs; a retake of the three series (EC-5) adds 18. Stage 5 stops and reports rather than exceed 60 (REC1).
- [non-blocking] NFR-3 counts "at most one judge session" per case run, while `llmJudge` retries once on a non-JSON reply (`evals/src/scoring/llm-judge.ts:50-55`). A retry is not visible in `records.jsonl`; the session count is read as records + judged records.
- [non-blocking] A judge that fails twice throws after `record()` has written `outcome: true` with empty `practices` (`evals/src/records/record.ts:51-58`). Such a record in the full or restored series is not a green run: the series script shows it as a practice with a `total` below 2. Treat it as EC-5.
- [non-blocking] Case A is red only through the judge. `OA-10` is deliberately not in its gate, so that the broken series records the practice as `0/2`: a failed gate skips the judge and would leave the practice out of `repeat-onion-architecture-broken.json`, which AC-15 and AC-22 read. I read AC-7 as covering bare literals (`Verdict:`, `Must fix`, the two file paths); "a row cites OA-10 for this throw" is a claim a substring does not settle.
- [non-blocking] With the rule removed, the model may answer `Verdict: PASS`; the gate `Verdict:` still passes, so the judge still runs. If a broken run prints no `Verdict:` at all, the outcome is still false (AC-13 holds) but the practice line is missing for that run.
- [non-blocking] All three cases are gated on skill-only literals, so at baseline the judge is usually skipped and the benchmark shows `missing_data` instead of a practice rate. The benchmark then proves lift per case, not per practice.
- [non-blocking] Practice identity in the series files is the text the judge echoes back (`evals/src/records/stats.ts:114`). The `dependency-checker` series show verbatim echoes including backticks and dashes; if a key differs by a character between two series, compare by reading before calling AC-15 failed.
- [non-blocking] EC-9: the `skills` job of `evals.yml` blocks the pull request and runs on `deepseek/deepseek-v4-flash`. A red job there is read from its artifact; no case is changed for it under this plan.
- [non-blocking] NFR-6's "selects this suite alone" holds for this feature's own paths. Other work on the branch (SPEC-07, `.claude/`) will select the workflow tier in the same pull request; that is outside this plan.
- [non-blocking] NFR-2's "run header": a plain `vitest run` prints no model line that I could confirm by reading. The evidence is the `env -u` prefix and the `Task model … · judge …` line of `benchmark.md`.
- Not checked: whether Haiku cites `OA-10` reliably with the full skill, and whether it stops citing it without the rule. Both are what stages 3 and 5 measure; no read-only check could tell.

## 8. Handoff to reviewers
- Architecture: nothing — no product code, no port, no module edge. The fixtures contain deliberate layering violations; they are excluded from typecheck and are never imported.
- Security: fixtures are authored text inlined into a no-tools session (UI-1); model output goes to the judge and to the git-ignored `evals/results/` (UI-2). The one sensitive action is the temporary edit of a live skill in stage 5: while it lasts, any session or agent that loads `onion-architecture` reads a skill without OA-10.
- `/implement` does not fit this plan: `plan-verifier` and `architecture-reviewer` have no server diff to read, and stages 3–5 are not agent work. Section 6 is the verification.

## 9. Execution
Mode: single-agent — the calling session executes stages 1 → 6 (questions 1–3 answered 2026-10-12 with the recommended options, by the user's "take all recommended"; the window of question 3 is kept by the calling session itself: no other eval runs during stages 3–5 and no agent that loads `onion-architecture` runs during the break of stage 5)
Recommended: single-agent — one package, one write set, every stage consumes the previous one's output.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| suite | 1–2 | `evals/skills/onion-architecture/**` | — | alone; the calling session (recommended) or one implementer brief |
| suite | 3–4 | `evals/skills/onion-architecture/**`, `evals/results/**` | 2 | alone; the calling session only — paid |
| suite | 5 | `.claude/skills/onion-architecture/SKILL.md` (temporary), `evals/results/**` | 4 | alone; the calling session only — paid |
| suite | 6 | `INSIGHTS.md` (root) | 5 | alone; the calling session |

Briefs:
- Question 2 answered "calling session": there is no implementer brief; the calling session executes stages 1 → 6 in order.
- Question 2 answered "implementer", one brief for stages 1–2: "Execute stages 1–2 of specs/2026-10-12-own-skill-eval-plan.md (track suite). Write only inside: evals/skills/onion-architecture/. Check with the commands of stage 2 — check-code.sh has no evals lane. Do not run `vitest run`, `pnpm eval`, `eval:repeat` or `eval:benchmark`: each is a paid model run that belongs to the calling session. Do not edit `.claude/skills/**` or `evals/src/**`."
- Stages 3–6 are never briefed to an agent.

single-agent: the same order, 1 → 6; the Runs column is not used.

## 10. Recommendations — not applied
- REC1 [requirements] State whether a retake under EC-5 counts inside NFR-3's 60 case runs, or give it its own allowance — why: with 3 cases a retake fits only when calibration used 6 runs or fewer (6 + 18 + 18 + 18 = 60), and with 4 cases it never fits (`specs/2026-10-12-own-skill-eval.md:124-126,154-158`) — would change: the stop condition of stage 5.
- REC2 [approach] Give `check-code.sh` an `evals` lane (typecheck plus `vitest run src/`, no model) — why: `.claude/agents/scripts/check-code.sh:43` accepts only `server|client|reviewer-core|mcp`, so no agent has a one-command check for harness work — would change: stage 2's commands and the answer to question 2. It touches `.claude/agents/scripts/`, where other work on this branch is under way, so it is a separate change.

Files this plan rests on:
- `/home/klov/emdash/repositories/dev-digest/specs/2026-10-12-own-skill-eval.md`
- `/home/klov/emdash/repositories/dev-digest/.claude/skills/onion-architecture/SKILL.md` (OA-10 at lines 118–120)
- `/home/klov/emdash/repositories/dev-digest/evals/skills/dependency-checker/dependency-checker.eval.ts`
- `/home/klov/emdash/repositories/dev-digest/evals/src/dsl/case.ts`
- `/home/klov/emdash/repositories/dev-digest/evals/src/repeat.ts`
- `/home/klov/emdash/repositories/dev-digest/evals/src/records/record.ts`
- `/home/klov/emdash/repositories/dev-digest/evals/scripts/ci-detect.mjs`
- `/home/klov/emdash/repositories/dev-digest/.claude/agents/scripts/guard-lib.sh`
- `/home/klov/emdash/repositories/dev-digest/.claude/agents/scripts/check-code.sh`

Save target: `/home/klov/emdash/repositories/dev-digest/specs/2026-10-12-own-skill-eval-plan.md`

---

<!-- returned before the plan title -->

## Questions for the user
The calling session asks these with AskUserQuestion and sends the answers back; the implementer does not start before every [blocking] one is answered.

1. [blocking] Execution mode — multi-agent or single-agent?
   - single-agent (recommended) — one package, one write set, and every stage needs the previous one's output; nothing can run in parallel.
   - multi-agent — no second track exists, so it adds agent start-up cost and saves no time.
2. [blocking] Who writes the files of stages 1–2?
   - the calling session (recommended) — five small files, and the same session rewords `onion-architecture.cases.ts` between paid runs in stage 3. `check-code.sh` has no `evals` lane (`.claude/agents/scripts/check-code.sh:43`), so an `implementer` has no single check command here, and its "add tests, verify" habit could start a paid `vitest run` outside the budget.
   - one `implementer` brief for stages 1–2 — `implementer-guard.sh` does not refuse paths under `evals/` (`.claude/agents/scripts/guard-lib.sh:90-108`), so it can write there. It costs a fresh agent context for about 120 lines, and the brief must forbid every model-backed command.
3. [blocking] When do the paid stages 3–5 run, given the parallel work on this branch?
   - in a window the user confirms (recommended) — no other session runs an eval in `evals/` during stages 3–5, and no agent of the parallel `server/` work runs during the break in stage 5. The SPEC-07 hook work runs its `pnpm eval:workflow` before stage 2 records `L0`, or after stage 6. Reason: `eval:repeat` and `eval:benchmark` pool every record appended after their start line (`evals/src/repeat.ts:97,116`), and during the break the live `SKILL.md` lacks OA-10 for anyone who reads it.
   - run regardless — a series that pooled a foreign record is retaken, which the 60-run cap may not allow; AC-21 is reported as not met for the foreign records.

Recommendations awaiting a decision: REC1, REC2 (section 10) — accept before implementation starts, or the plan stands as written.
Gaps for `spec-creator`, not questions of mine: none.
