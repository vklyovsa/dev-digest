# Implementation Plan — Mutation testing on one file (SPEC-08)
Source: `server/specs/2026-10-12-mutation-testing-on-one-file.md` (Status: approved, `check-spec.sh` ok, 0 FAIL) · Base: 1d4e77f · Packages: server
Repository root: `/home/klov/emdash/repositories/dev-digest` — every path below is relative to it.

## 0. Before the first edit
- INSIGHTS: root § Tool & Library Notes — "pnpm 12.4.2 exits non-zero with `ERR_PNPM_IGNORED_BUILDS` AFTER doing the work" (2026-09-28) → judge the add by `package.json` + lockfile; if `pnpm <script>` refuses, run `./node_modules/.bin/stryker`; never answer `approve-builds`.
- INSIGHTS: root § Tool & Library Notes — "a `pnpm-workspace.yaml` holding only `allowBuilds:` is safe to commit" (2026-10-12) → the tracked stub stays byte-identical (AC-23). Restore it by `cp` from a snapshot, because `git restore` is not available to the session.
- INSIGHTS: `server/INSIGHTS.md` § What Doesn't Work — hermetic lane pin (2026-10-04, 2026-09-23) → the narrowed config carries the same `test.env.DATABASE_URL`.
- INSIGHTS: `server/INSIGHTS.md` § Tool & Library Notes — "`pnpm typecheck` does not look at `test/**`" (2026-09-21) and § Recurring Errors, the `/tmp` tsconfig recipe with `typeRoots` (2026-10-05) → the new config test is type-checked by the session with that recipe.
- INSIGHTS: root § What Doesn't Work — "`git grep` passes vacuously for an untracked module" (2026-09-27) → `scoring.ts` and `scoring.test.ts` are untracked (`git status --short` prints `??`); see Q1.
- Read: the spec; `git show base/full-functionality:server/stryker.config.json`; `git show base/full-functionality:server/stryker.vitest.config.ts`.

## 1. Scope — as the source states it
Goal: G-1…G-4 — spec `:30-33`. Non-goals: NG-1…NG-7 — spec `:35-41`. Criteria are not restated; this table points at them.

| Criteria (spec line) | Stage | Checked by |
|---|---|---|
| AC-1, AC-2, AC-3 (`:63-65`), AC-20, AC-21 (`:97-98`) | 1, 2 | `server/test/mutation-config.test.ts` in the unit lane |
| AC-19 (`:93`), NFR-4, EC-14, EC-15 | 2 | smoke run and `git status --short server` diff |
| AC-23 (`:100`), NFR-6, EC-12 | 1 | `cmp` against the snapshot; `git status --short server/pnpm-workspace.yaml` |
| AC-4, AC-5, AC-25 (`:66`, `:70`, `:76`), NFR-1, NFR-3 | 3 | baseline console output and `reports/mutation/mutation.json` |
| AC-6, AC-7 (`:71-72`) | 4 | the added test in the unit lane |
| AC-8, AC-9, AC-10, AC-18 (`:73-77`) | 4 | re-run JSON; `git diff <baseline-sha>` — depends on Q1 |
| AC-11…AC-16, AC-26, AC-24 (`:81-88`) | 5 | reading the four documents against the two reports — AC-12 depends on Q1 |
| AC-17 (`:92`), NFR-5 | 5 | `git status --short .github`; `check-code.sh server` |
| AC-22 (`:99`) | after the user's commit | CI install step on that commit (manual, the user's) |

Nothing is `already there`: no `@stryker-mutator` entry in `server/pnpm-lock.yaml`, no `server/stryker*`, no `server/.gitignore`, no `reports/` or `.stryker-tmp/` rule in `.gitignore`.

## 2. Impact map
| Package | Path | New / Modify | Placement | AC |
|---|---|---|---|---|
| server | `server/package.json`, `server/pnpm-lock.yaml` | Modify (lockfile through pnpm only) | manifest | AC-20, AC-21 |
| server | `server/stryker.config.json` | New | package root, beside `vitest.config.ts` | AC-1 |
| server | `server/stryker.vitest.config.ts` | New | package root | AC-2, AC-3 |
| server | `server/test/mutation-config.test.ts` | New | hermetic test — **not in the write set you listed**; the spec requires it (`:63-65`, `:97-98`, Surfaces `:134`) | AC-1…3, 20, 21 |
| root | `.gitignore` | Modify | two scoped rules | AC-19 |
| server | `server/src/modules/eval/scoring.test.ts` | Modify (one added test) | beside the target | AC-7 |
| server | `server/docs/mutation-testing.md` | New | the record | AC-11…16 |
| server | `server/docs/README.md`, `server/AGENTS.md` | Modify (one line each) | Contents / Read when | AC-11 |
| root | `TESTING.md` | Modify (one line) | § Running locally | AC-24 |

Fallback only (AC-25): `server/test/pulls-findings-summary.test.ts` replaces `scoring.test.ts` as the file that receives the added test.

## 3. Constraints in play
- `server/src/modules/eval/scoring.ts` is never edited (AC-10, NG-5); no non-test file under `server/src/` changes (NFR-5).
- `.github/workflows/**` and `server/pnpm-workspace.yaml` stay unchanged (AC-17, AC-23).
- The lockfile changes only through `pnpm add -D`; no build-approval prompt is answered (NFR-6).
- No `inPlace` in the Stryker config: an interrupted in-place run could leave the mutated target in the tree (AC-10, AC-19).
- `pnpm add`, the smoke run, the baseline and the re-run happen only while no other test run or pnpm command is in flight in `server/` (SPEC-04 is being built in `server/src/modules/eval/**`).
- depcruise scans `src` only and `tsconfig.json` includes `src/**/*.ts` only, so the two root config files are outside both, like `vitest.config.ts`.

## 4. Stages
Every stage is a checklist for the **calling session**; no `implementer` is dispatched (section 9). Scratch folder for the run: `mkdir -p /tmp/spec08`.

### Stage 1 — Pinned tool and the script
Track: session · After: —
Files: `server/package.json`, `server/pnpm-lock.yaml`
Read first: `server/package.json` (scripts block, devDependencies), `server/pnpm-workspace.yaml`, `server/.npmrc`
Steps:
1. `cp server/pnpm-workspace.yaml /tmp/spec08/pnpm-workspace.yaml.before` and `git status --short server > /tmp/spec08/status.before`.
2. `cd server && pnpm add -D --save-exact @stryker-mutator/core@9.6.1 @stryker-mutator/vitest-runner@9.6.1`. A non-zero exit with `ERR_PNPM_IGNORED_BUILDS` is expected; do not answer or run `approve-builds`.
3. Judge the add:
   - `grep -n '@stryker-mutator' server/package.json` shows both as `"9.6.1"` with no `^`.
   - `grep -n '@stryker-mutator/\(core\|vitest-runner\)@' server/pnpm-lock.yaml` shows 9.6.1 only.
   - `sed -n 1p server/pnpm-lock.yaml` is still `lockfileVersion: '9.0'`. If it changed, stop and report: CI runs pnpm 10 (`.github/workflows/server-unit.yml:50`), AC-22 is at risk.
   - `git diff server/package.json` shows no other version moved.
4. `cmp server/pnpm-workspace.yaml /tmp/spec08/pnpm-workspace.yaml.before`. If they differ, `cp /tmp/spec08/pnpm-workspace.yaml.before server/pnpm-workspace.yaml` and `cmp` again.
5. Add to `scripts` in `server/package.json`, after `verify:l06`: `"mutation:eval-scoring": "stryker run stryker.config.json"`.
6. `cd server && ./node_modules/.bin/stryker --version` prints `9.6.1`. Read pnpm's peer warnings: the runner is expected to accept the installed vitest 2.1.9 — verify at run time.
Skills: none routed (manifest). Rule: `server/AGENTS.md` § Do not touch — lockfile only through `pnpm add`.
Tests to add: none here (Stage 2 asserts AC-20, AC-21).
Done when: steps 3, 4 and 6 hold.

### Stage 2 — Two configs, ignore rules, the config test, a smoke run
Track: session · After: 1
Files: `server/stryker.config.json`, `server/stryker.vitest.config.ts`, `.gitignore`, `server/test/mutation-config.test.ts`
Read first: `server/vitest.config.ts` (the values to mirror), `server/test/hermetic-env.test.ts` (shape of a small hermetic test), `.gitignore`
Steps:
1. Write `server/stryker.config.json` with exactly this content. It is the lesson's file plus the `json` reporter (machine-readable statuses for AC-5 and AC-8) and `ignorePatterns` (NFR-4, `.env` kept out of the sandbox):
```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "testRunner": "vitest",
  "vitest": {
    "configFile": "stryker.vitest.config.ts"
  },
  "mutate": ["src/modules/eval/scoring.ts"],
  "reporters": ["html", "json", "clear-text", "progress"],
  "coverageAnalysis": "perTest",
  "tempDirName": ".stryker-tmp",
  "ignorePatterns": ["/clones", ".env", ".env.*"]
}
```
2. Write `server/stryker.vitest.config.ts` with exactly this content. It is the lesson's file plus the `env` pin (AC-3, DR-1) and has no comments:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, 'src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/modules/eval/scoring.test.ts'],
    env: { DATABASE_URL: 'postgres://isolated:isolated@127.0.0.1:1/isolated' },
  },
});
```
3. Append to `.gitignore` (root; there is no `server/.gitignore`), scoped so no other `reports/` folder is hidden:
```
# Stryker mutation run (local only): sandbox and reports
server/.stryker-tmp/
server/reports/
```
4. Write `server/test/mutation-config.test.ts`: one `describe`, paths resolved from `fileURLToPath(new URL('..', import.meta.url))`, with these assertions:
   - AC-1: `mutate` of the parsed `stryker.config.json` has length 1; the file exists; its name does not end in `.test.ts`.
   - AC-2: every `test.include` entry of the narrowed config has no glob character, exists, does not end in `.it.test.ts`, and its text holds a relative import that resolves (`.js` → `.ts`) to the `mutate` path.
   - AC-3: `(await import('../stryker.vitest.config.ts')).default` and `(await import('../vitest.config.ts')).default` have equal `test.env.DATABASE_URL` and `resolve.alias` (`toEqual`).
   - AC-20: both `devDependencies` entries of `package.json` are `toBe('9.6.1')`.
   - AC-21: `scripts['mutation:eval-scoring']` is `toBe('stryker run stryker.config.json')`.
   - Verify at run time: that both configs import cleanly inside a test (`__dirname` under vite-node). Fallback: read both files as text and compare the `DATABASE_URL` literal and the alias block.
5. Smoke run (boots the tool, proves the sandbox content, EC-11): `cd server && ./node_modules/.bin/stryker run stryker.config.json --dryRunOnly --cleanTempDir false`. Then:
   - `find server/.stryker-tmp -path '*/clones/*' -print -quit` prints nothing.
   - `find server/.stryker-tmp -name '.env*' -not -path '*/node_modules/*'` prints nothing.
   - `git status --short server | diff - /tmp/spec08/status.before` shows only this plan's files.
   - `rm -rf server/.stryker-tmp`.
   - Verify at run time: the two flags, the `/clones` pattern form and the default report paths (`reports/mutation/mutation.{html,json}`). Fallbacks: pattern `clones/**`; for the sandbox check, start the run in the background and `find` while it runs.
6. Interrupted run (AC-19, EC-14): `cd server && timeout 5 ./node_modules/.bin/stryker run stryker.config.json`. `git status --short server` shows no `.stryker-tmp` or `reports` entry. Leave the folder in place: Stage 3 must start with it present.
7. If any run stops with `ERR_REQUIRE_ESM` (EC-11): `find server/node_modules -path '*/node_modules/@babel/core/package.json'` shows stale nested trees. The fix is `rm -rf server/node_modules && cd server && pnpm install --frozen-lockfile`, done only with the dev stack down and no run in flight; otherwise report to the user.
Skills: `onion-architecture` → `rules/testing.md` — hermetic test named `<area>.test.ts`, no `test/helpers/pg.ts`.
Tests to add: `server/test/mutation-config.test.ts` — AC-1, AC-2, AC-3, AC-20, AC-21.
Done when: `.claude/agents/scripts/check-code.sh server` is green and steps 5 and 6 hold.

### Gate — the baseline commit (Q1)
The user commits at least the target, `scoring.test.ts` and the files of Stages 1–2. The session cannot commit. Record `git rev-parse --short HEAD` as `<baseline-sha>`, and confirm `git status --short server/src/modules/eval/scoring.ts server/src/modules/eval/scoring.test.ts` prints nothing.

### Stage 3 — Baseline and the chosen mutant
Track: session · After: gate
Files: none written in the repository (reports are git-ignored)
Read first: `server/src/modules/eval/scoring.ts`, `server/src/modules/eval/scoring.test.ts:1-36` (helpers `range`, `execution`, `tally`)
Steps:
1. `sha256sum server/src/modules/eval/scoring.ts server/src/modules/eval/scoring.test.ts > /tmp/spec08/sha.before`.
2. Baseline, with a 300000 ms tool timeout (NFR-3): `cd server && env -u OPENROUTER_API_KEY -u OPENAI_API_KEY -u ANTHROPIC_API_KEY pnpm mutation:eval-scoring 2>&1 | tee /tmp/spec08/baseline.console.txt`. If pnpm refuses before running the script, use the same line with `./node_modules/.bin/stryker run stryker.config.json`, and that direct form becomes the command in the record.
3. `cp server/reports/mutation/mutation.json /tmp/spec08/baseline.json`. Counts and candidates:
```sh
cd server && node -e 'const r=require("./reports/mutation/mutation.json");const c={};for(const[f,v]of Object.entries(r.files))for(const m of v.mutants){c[m.status]=(c[m.status]||0)+1;if(m.status==="Survived"||m.status==="NoCoverage")console.log(m.status,f+":"+m.location.start.line+":"+m.location.start.column,m.mutatorName,JSON.stringify(m.replacement))}console.log(c)'
```
   Take the six values (total, killed, survived, no coverage, timeout, score) and the duration (`Done in …`) from the clear-text table in `baseline.console.txt`; the JSON must agree.
4. Choose one mutant (AC-5, AC-6, EC-5): a `Survived` one, or a `NoCoverage` one only when survived is 0. It must have an input to an exported function for which the original and the replacement return different results. Write down that input and both results; skip an equivalent mutant and take the next.
5. Fallback branch (AC-25, AC-26), only when the baseline has 0 survived and 0 no coverage:
   - Keep `/tmp/spec08/baseline.json` and the console file as the first baseline.
   - Set `mutate` to `["src/modules/pulls/findings-summary.ts"]` and `include` to `['test/pulls-findings-summary.test.ts']`.
   - Rename the script to `mutation:findings-summary`, in `package.json` and in the config test.
   - Run `check-code.sh server`; the user commits again (new `<baseline-sha>`); repeat steps 1–4 on the new target.
Skills: none (no file written).
Tests to add: none.
Done when: the run finished inside 5 minutes with a report; a chosen mutant with its file, line, mutator, original text, replacement, status, input and two results is noted; `git status --short server` shows nothing the run created.

### Stage 4 — The added test and the re-run
Track: session · After: 3
Files: `server/src/modules/eval/scoring.test.ts` (fallback: `server/test/pulls-findings-summary.test.ts`)
Read first: the `describe` block of `scoring.test.ts` that covers the mutated line (block starts: `:37` matching, `:115` `scoreCase`, `:304` `scoreRun`)
Steps:
1. Add exactly one `it(...)` to the matching `describe`, built from the existing helpers. It asserts the original result for the input of Stage 3, and its title states the behaviour. Nothing else in the file changes (AC-18).
2. `cd server && pnpm exec vitest run src/modules/eval/scoring.test.ts` is green on the unmodified target (AC-7).
3. Re-run with the command of Stage 3 step 2, teeing to `/tmp/spec08/rerun.console.txt`; `cp server/reports/mutation/mutation.json /tmp/spec08/rerun.json`.
4. Check:
   - The mutant with the same file, line, column, `mutatorName` and `replacement` has status `Killed` in `rerun.json` (AC-8). If it is still `Survived`, the test is wrong (EC-6): fix the test and re-run.
   - The two totals are equal (AC-9).
   - `sha256sum -c` on the `scoring.ts` line of `/tmp/spec08/sha.before` passes, and `git diff --quiet <baseline-sha> -- server/src/modules/eval/scoring.ts` exits 0 (AC-10).
   - `git diff <baseline-sha> -- server/src/modules/eval/scoring.test.ts` shows the one added block only (AC-18).
   - If either file changed for another reason (EC-9, SPEC-04 in flight), both runs are taken again.
Skills: `onion-architecture` → `rules/testing.md` — pure inputs → assertions, no doubles; `TESTING.md` § Philosophy — one test for the edge.
Tests to add: the one test above — AC-7, AC-8.
Done when: the four checks of step 4 hold.

### Stage 5 — The record and the three links
Track: session · After: 4
Files: `server/docs/mutation-testing.md` (New), `server/docs/README.md`, `server/AGENTS.md`, `TESTING.md`
Read first: `server/docs/README.md`, `server/docs/prompt-logging.md` (length and tone of a server doc), `server/AGENTS.md:23-43`, `TESTING.md:87-107`
Steps:
1. Write `server/docs/mutation-testing.md` with a title line stating the topic and short sections filled from `/tmp/spec08/*`:
   - Run (AC-12): the command, Stryker and its version, the target path, `<baseline-sha>`, the printed duration, the report file `server/reports/mutation/mutation.json` (git-ignored, rewritten by each run).
   - Baseline (AC-13): the six values, zero written as 0.
   - Chosen mutant (AC-5, AC-6, AC-14): `path:line`, mutator, original text, replacement text, its baseline status, the input and the two results.
   - Added test (AC-15): the file and the test title; the six values of the re-run.
   - Left alive (AC-16): the number, only when survived or no coverage is above 0 after the re-run.
   - First baseline (AC-26): only on the fallback branch.
   Numbers only; no per-survivor classification (DR-5 rejected).
2. `server/docs/README.md` § Contents: one entry for `mutation-testing.md`.
3. `server/AGENTS.md` § Read when: one line — running or reading the mutation run → `docs/mutation-testing.md`.
4. `TESTING.md` § Running locally, inside the code block after the server lines: `cd server && pnpm mutation:eval-scoring   # mutation run on one module (Stryker) — local only, not a CI lane` (the renamed script on the fallback branch).
Skills: conventions lane only (`routing.md`: root `*.md`, `docs/**`); `server/docs/README.md` rules — one topic per file, linked from `AGENTS.md`.
Tests to add: none (AC-11…16, AC-24 are `verify: manual`).
Done when: every value in the record matches `/tmp/spec08/{baseline,rerun}.{console.txt,json}`; the title of the added test is found by `grep -n` in the named file; section 6 is green.

## 5. Skills matrix
| Stage | onion-architecture | conventions lane |
|---|---|---|
| 1 | — | `server/AGENTS.md` § Do not touch |
| 2 | `rules/testing.md` | `AGENTS.md` § Naming (tests) |
| 3 | — | — |
| 4 | `rules/testing.md` | `TESTING.md` § Philosophy |
| 5 | — | `server/docs/README.md` |

## 6. Verification
| Package | Command (from the repository root) | Proves |
|---|---|---|
| server | `.claude/agents/scripts/check-code.sh server` | typecheck, depcruise, unit lane with the config test and the added test — AC-1…3, AC-7, AC-20, AC-21, NFR-5 |
| server | `/tmp` tsconfig recipe with `typeRoots` (`server/INSIGHTS.md` § Recurring Errors) over `server/test/mutation-config.test.ts` | the new test type-checks; `pnpm typecheck` skips `test/**` |
| server | `git status --short .github server/pnpm-workspace.yaml` prints nothing | AC-17, AC-23 |
| server | `git status --short server \| grep -E 'stryker-tmp\|reports'` prints nothing after the last run | AC-19 |
| server | `grep -n 'adapters/' server/src/modules/eval/scoring.ts server/src/modules/eval/scoring.test.ts` prints nothing | NFR-1 |
| server | pnpm 10 on a `/tmp` copy of `package.json`, `pnpm-lock.yaml`, `.npmrc`, `pnpm-workspace.yaml`: `install --frozen-lockfile --lockfile-only` exits 0 | local stand-in for AC-22; the real proof is CI on the user's commit |

## 7. Risks and open questions
- [settled 2026-10-12, declared deviation] Q1: the baseline is taken on the uncommitted tree. The user commits once, at the end of the whole homework, and the calling session may not commit; so the record names base `1d4e77f` plus the working tree and identifies the content by the sha256 of `scoring.ts` and `scoring.test.ts` taken before the baseline and checked after the re-run. AC-10 and AC-18 are proven by those hashes and by a saved copy of the test file (`diff` shows the one added block), not by `git log`; AC-12's "commit SHA" is the deviation. After the user's commit the run can be repeated on that commit with the same command.
- Q1 as returned: the baseline commit. `scoring.ts` and `scoring.test.ts` are untracked and `server/package.json` is modified. AC-12 (`:82`) wants "the short commit SHA the baseline was taken on" with a re-run "on the stated commit", and AC-10 / AC-18 (`:75`, `:77`) are verified with `git log` / `git status --short`. On the tree as it is, 1d4e77f holds neither the target nor the configs. Options: (a) the user commits before Stage 3; (b) baseline on the dirty tree — then AC-10, AC-12 and AC-18 cannot be met as written and the gap goes to `spec-creator`. Stages 3–5 wait.
- [non-blocking] NFR-2's check "the baseline completes with Docker stopped" is not planned: Docker holds the dev database and stopping it is the user's call. The evidence is AC-2 and AC-3 in the config test plus the unreachable `DATABASE_URL`.
- [non-blocking] Unverified until the tool is installed: `--dryRunOnly`, `--cleanTempDir false`, the `/clones` pattern form, the default report paths, the vitest peer range of the runner. Each has its fallback in Stage 2.
- [non-blocking] `pnpm add` re-links `server/node_modules`; a SPEC-04 test run in flight at that moment can fail for no reason of its own. The session sequences Stage 1 as well as the runs.
- [non-blocking] Root `AGENTS.md` § Do not touch and `.github/workflows/server-unit.yml:73,107` still call `server/package.json` `skip-worktree`; in this clone it is not (EC-13). Not in this change set.
- [non-blocking] If the 88 tests kill everything, Stage 3 step 5 (fallback) adds one more user commit and widens the write set by `server/test/pulls-findings-summary.test.ts`.

## 8. Handoff to reviewers
- Architecture: nothing under `server/src/` but one test; no port, module or layer edge.
- Security: two third-party dev dependencies at exact versions (NFR-6); the sandbox excludes `clones/` and `.env*` (Stage 2 step 5); no build script approved.

## 9. Execution
Mode: single-agent, executed by the **calling session** — stated in the task text. An `implementer` is refused edits to `server/package.json` and lockfiles by its guard, and the work is a tool run plus one test.
Recommended: the same — the stages chain, one package, one test.
| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| session | 1–2 | `server/package.json`, `server/pnpm-lock.yaml`, `server/stryker.config.json`, `server/stryker.vitest.config.ts`, `server/test/mutation-config.test.ts`, `.gitignore` | — | alone, no other run in `server/` |
| user | gate | the commit | 1–2 | — |
| session | 3–4 | `server/src/modules/eval/scoring.test.ts` | gate | alone, no other run in `server/` |
| session | 5 | `server/docs/mutation-testing.md`, `server/docs/README.md`, `server/AGENTS.md`, `TESTING.md` | 4 | — |
Briefs: none — no `implementer` is dispatched; the session runs the three rows in order and stops at the gate.

## 10. Recommendations — not applied
none

## Questions for the user
The calling session relays these; Stages 3–5 do not start before the [blocking] one is settled.
1. [blocking] Q1 — Baseline commit: will you commit before the baseline run?
   - Commit first (recommended) — at least `server/src/modules/eval/scoring.ts`, `scoring.test.ts` and the files of Stages 1–2. This is the only route on which AC-10, AC-12 and AC-18 hold as written. "Take all recommended" cannot cover it: the session may not commit, so it stops after Stage 2 and asks you for the commit.
   - Baseline on the uncommitted tree — saves the stop, but the record would name a commit that does not hold the target. That is a gap for `spec-creator`, not something the plan settles.
2. Execution mode — no question: single-agent by the calling session, as the task states (section 9).

Recommendations awaiting a decision: none.
Gaps for `spec-creator`, not questions of mine: none while Q1 is answered "commit first".
One deviation from the write set you gave: `server/test/mutation-config.test.ts` (New) is added because the spec makes it the check of AC-1…AC-3, AC-20 and AC-21.

---

## Deviations recorded at execution (2026-10-12)

- The target changed twice: `eval/scoring.ts` (97/97 killed) and the spec's fallback `pulls/findings-summary.ts` (28/28 killed) left no mutant to choose; the spec has no rule for a fallback without survivors. The run was moved to `server/src/modules/eval/helpers.ts` with `test/eval-helpers.test.ts` and `test/eval-case-editor.test.ts`; the script is `mutation:eval-helpers`; the added test went into `test/eval-helpers.test.ts`. All three baselines are in `server/docs/mutation-testing.md`.
- `stryker.config.json` carries `plugins`, and `stryker.vitest.config.ts` resolves `../reviewer-core` from the real package root (sandbox depth) — neither is in the lesson's files.
- The baseline was taken on the uncommitted tree (settled Q1); content is identified by sha256.
