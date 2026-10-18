# Implementation Plan — Export to CI
Source: `specs/2026-10-18-export-to-ci.md` (SPEC-12, Status: approved) · Base: `a8c0a3b` (worktree `devdigest-ci`, branch `feat/export-to-ci`) · Packages: server, client, agent-runner (tooling)

## 0. Before the first edit
- INSIGHTS: `INSIGHTS.md § Tool & Library Notes` — "pnpm 12.4.2 exits non-zero with ERR_PNPM_IGNORED_BUILDS AFTER doing the work" → Stage 2 (`pnpm build`) and Stage 3 (`pnpm add`): judge success by the output (`dist/index.js`, the lockfile), never answer approve-builds, and restore `server/pnpm-workspace.yaml` (tracked) if pnpm changes it.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "A per-brief filtered check stays green while parallel implementers break each other" → once briefs 2 and 3 have both landed, run unfiltered `check-code.sh server` and `check-code.sh client` before plan-verifier.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "An implementer's token bill is turns × standing context" → three briefs of two stages each, a `Read first:` list per stage, reads batched in one message.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "Proving absence with git grep passes vacuously for a new, still-untracked module" → absence checks over `server/src/modules/ci/` use `grep -rn`.
- INSIGHTS: `INSIGHTS.md § Codebase Patterns` — "The starter pre-wires a course lesson…" → extend `client/messages/en/ci.json`, the `ci-runs` key in `client/src/components/app-shell/helpers.ts:38`, `shell.json` `ci-runs` and the existing `agents.json` `editor.tabs.ci`; no new namespace or contract.
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes` — "tsx watch does not restart the dev API when a file under src/vendor/ changes" → restart the :3021 API after Stage 1 before any manual check.
- INSIGHTS: `server/INSIGHTS.md § What Doesn't Work` — "pull_requests.head_sha moves only when the PR LIST is synced" (EC-17) → Stage 4 compares the artifact with the workflow run's `head_sha` from GitHub, never with a stored PR.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors` — "The client's vendored @devdigest/shared is a TYPE-only dependency" → client code uses `import type` only; triggers, post modes and Fail CI options are local literal tuples guarded by `Exclude<…>`.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "Chip always renders a <button>" and "MonoLink renders a <button> when it is given no href" → triggers and post modes use native checkbox/radio inputs (NFR-11); the job link is a plain `<a href>`.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors` — "a CSS grid child has min-width: auto" → the CI Runs table uses `minmax(0, 1fr)` tracks and `overflowWrap: "anywhere"` on repository and agent cells.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors` — "The PR page renders blank … after pnpm build in client/" → never run `next build` in the live `client/` while the :3020 web app runs.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "A bare ICU argument does not group digits" → count arguments in `ci.json` are typed `{n, number}`.
- INSIGHTS: `agent-runner/insights/INSIGHTS.md § Open Questions` — "`AgentManifest` has no `post_as` field…" → closed by DR-12: the workflow sets `DEVDIGEST_POST_AS`, `index.ts` already reads it.
- INSIGHTS: `agent-runner/insights/INSIGHTS.md § What Doesn't Work` — "`pnpm typecheck` in agent-runner fails … if reviewer-core/node_modules was never installed" → `reviewer-core/node_modules` exists in this worktree; nothing to do.
- INSIGHTS: `agent-runner/insights/INSIGHTS.md § Recurring Errors` — "discriminate on `result.artifact === null`" → keep that narrowing when `run.ts` changes.
- Read: `specs/2026-10-18-export-to-ci.md` (§ Contracts, § Ownership and merge order), `specs/2026-10-18-multi-agent-review.md` § Contracts "Finding attribution" and § Worktree boundaries, `agent-runner/CLAUDE.md`.

## 1. Scope — as the source states it
Goal: **G-1** An agent author exports an agent to a GitHub repository through a four-step wizard, as a pull request on branch `devdigest/ci` or as a zip, after seeing every file. — `specs/2026-10-18-export-to-ci.md:40`
Goal: **G-2** In the target repository every pull request event runs the exported agent in GitHub Actions with the bundled runner, posts the result in the chosen mode, and fails the check by the agent's Fail CI on policy. — `:41`
Goal: **G-3** The studio pulls each CI result from GitHub over the user's authenticated GitHub API access, verifies it, and shows it on the CI Runs page and on the agent's CI tab. — `:42`
Goal: **G-4** Worktree B delivers G-1…G-3 without touching worktree A's areas and merges after A with every check green. — `:43`
Non-goals: **NG-1** CircleCI, Jenkins and Generic CLI targets … omitted from the wizard — `:44`; **NG-2** A push channel — no public ingest endpoint, no tunnel, no webhook — `:45`; **NG-3** A published marketplace action — `:46`; **NG-4** Storing CI findings as `reviews` / `findings` rows, linking a CI run to a studio PR (`agent_runs.pr_id` stays null), or showing CI runs on the PR page — `:47`; **NG-5** Background polling and an "auto-refresh" indicator — `:48`; **NG-6** More than one exported agent per repository — `:49`; **NG-7** Any change to the multi-run service, the Multi-Agent Review page, the PR findings feed, `reviewer-core/`, `mcp/` or the finding-attribution contract owned by worktree A — `:50`; **NG-8** Filters on CI Runs, a trace drawer from CI Runs, `LiveLogStream` and `AutoTriggerStatus` — `:51`; **NG-9** Reading, checking or writing GitHub Actions secrets from the studio — `:52`; **NG-10** Reviewing pull requests from forks — `:53`; **NG-11** A new database migration — `:54`

Acceptance criteria (wording cut, not rephrased):
- AC-1 WHEN the author clicks "Add to CI" on the CI tab, the agent page shall open the Export to CI dialog with the steps Target, Preview, Configure, Install and Target active. — `:84` — clear
- AC-2 The Export to CI dialog shall offer GitHub Actions as its only target, preselected, and an owner/name repository field prefilled with the active repository's full name. — `:85` — clear
- AC-3 IF the repository field does not read owner/name, THEN … keep Continue disabled on the Target step. — `:86` — clear
- AC-4 WHEN the author continues from Target, the Export to CI dialog shall list the files `POST /agents/:id/ci/preview` returns: `.devdigest/agents/<slug>.yaml`, one `.devdigest/skills/<skill-slug>.md` per enabled linked skill, `.devdigest/memory.jsonl`, `.devdigest/runner/index.js` and `.github/workflows/devdigest-review.yml`. — `:87` — clear (F1 is a risk for the runner file)
- AC-5 … `.github/workflows/devdigest-review.yml` in an editable text area, every other file read-only, and the runner bundle by path and size only. — `:88` — clear
- AC-6 WHEN the author installs after editing the workflow, … send the edited text as `workflow_yaml` in the install request. — `:89` — clear
- AC-7 The Configure step shall offer the triggers `opened`, `synchronize`, `reopened` with the first two preselected, and "Post results as" GitHub review (preselected), PR comment, None (exit code only). — `:90` — clear
- AC-8 IF no trigger is selected, THEN … keep Continue disabled on the Configure step. — `:91` — clear
- AC-9 The Configure step shall name the Actions secret `OPENROUTER_API_KEY` with the instruction to add it under Settings → Secrets and variables → Actions, without any value or set / not-set status for it. — `:92` — clear
- AC-10 The Configure step shall show the note that blocking a merge needs Fail CI on (CI tab) plus a required status check in the repository's branch protection, with no GitHub App. — `:93` — clear
- AC-11 The Install step shall offer "Open a PR with these files" (preselected) and "Download zip". — `:94` — clear
- AC-12 WHEN an install with "Open a PR with these files" succeeds, … show a link to the `pr_url` the API returned. — `:95` — clear
- AC-13 IF the install request answers an error, THEN … show the API's message on the Install step and keep "Download zip" available. — `:96` — clear
- AC-14 The API shall write `.devdigest/agents/<slug>.yaml` so that `AgentManifest` parses it back to the agent's name, model, system prompt, strategy, enabled skill slugs, `ci_fail_on` and `version`. — `:100` — clear
- AC-15 WHEN `POST /agents/:id/export-ci` is called, the API shall commit every generated file as one commit to branch `devdigest/ci` …, created from `base` when missing, and never to `base`. — `:101` — clear (`commitFiles` exists, `server/src/adapters/github/octokit.ts:272`)
- AC-16 WHEN that commit succeeds, the API shall open a pull request titled "Add DevDigest CI review" from `devdigest/ci` into `base`, or reuse the open pull request of that branch, and return its URL as `pr_url`. — `:102` — clear
- AC-17 The export commit shall leave exactly one file under `.devdigest/agents/` on `devdigest/ci`. — `:103` — clear (needs a prune in `commitFiles`, MI-8)
- AC-18 WHEN an export or a zip download succeeds, the API shall store one `ci_installations` row … with `target_type` `gha`, refreshing `installed_at` when the row exists. — `:104` — clear
- AC-19 IF the repository already has a `ci_installations` row of another agent, THEN the API shall answer 409 and commit nothing. — `:105` — clear
- AC-20 IF a generated file contains a secret value the studio's `SecretsProvider` holds, THEN the API shall answer 422 naming the file and commit nothing. — `:106` — clear
- AC-21 IF the runner bundle `agent-runner/dist/index.js` does not exist, THEN the API shall answer 409 with a message naming `cd agent-runner && pnpm build`. — `:107` — clear
- AC-22 WHEN `POST /agents/:id/ci/zip` is called, the API shall answer `application/zip` holding the same files as the export at their repository-relative paths. — `:108` — clear
- AC-23 IF GitHub refuses a call of the export, THEN the API shall answer 502 carrying GitHub's message and store no installation. — `:109` — clear
- AC-24 The API shall write `.devdigest/memory.jsonl` as one JSON object with `kind`, `scope` and `content` per `memory` row of the agent's workspace whose scope is `global`, and an empty file when there is none. — `:110` — clear
- AC-25 IF the request's `repo` does not read owner/name, THEN the API shall answer 422 before calling GitHub. — `:111` — clear
- AC-26 The API shall generate a workflow that triggers only on `pull_request` with the selected types and contains no `pull_request_target`. — `:115` — clear
- AC-27 … `permissions` exactly `contents: read` and `pull-requests: write`. — `:116` — clear
- AC-28 The API shall pin every `uses:` reference of the generated workflow to a full 40-character commit SHA. — `:117` — clear (R3 verification in Stage 3)
- AC-29 The API shall generate a checkout of the pull request's base commit with persisted credentials off… — `:118` — clear
- AC-30 The API shall generate a review step that runs `node .devdigest/runner/index.js` with `OPENROUTER_API_KEY` from `secrets.OPENROUTER_API_KEY`, `GITHUB_TOKEN` from the job token, `PR_NUMBER` from the event and `DEVDIGEST_POST_AS` set to the chosen mode. — `:119` — clear
- AC-31 The API shall place no `${{ }}` expression of the pull request title, body, head ref or a comment inside any `run:` script of the workflow. — `:120` — clear
- AC-32 The API shall generate an upload of `devdigest-result.json` as artifact `devdigest-result` in a step that runs whether the review step passed or failed and that ignores a missing file. — `:121` — clear
- AC-33 WHEN the runner finishes a grounded review, the runner shall write `devdigest-result.json` whose keys are exactly the fields of `CiResultArtifact`, with `head_sha` and `repository_id` taken from the `pull_request` event payload. — `:125` — clear (runner reads neither today, `agent-runner/src/context.ts:67-92`)
- AC-34 The runner shall write neither the `OPENROUTER_API_KEY` nor the `GITHUB_TOKEN` value to stdout, stderr, the artifact or a posted body. — `:126` — clear
- AC-35 WHILE the manifest's `ci_fail_on` is `critical`, WHEN a grounded finding is CRITICAL, the runner shall exit with code 1. — `:127` — already there `agent-runner/src/run.ts:144-158`
- AC-36 The runner shall publish per `DEVDIGEST_POST_AS`: a GitHub review, a PR comment, or nothing. — `:128` — already there `agent-runner/src/run.ts:150-156`, `agent-runner/src/index.ts:25-33`
- AC-37 IF the manifest fails `AgentManifest` validation, THEN the runner shall exit with code 1 and write no artifact. — `:129` — already there `agent-runner/src/manifest.ts:69-76`, `agent-runner/src/run.ts:163-171`
- AC-38 The runner shall send the diff and the PR body to the model only inside untrusted blocks. — `:130` — already there (`reviewPullRequest`, `agent-runner/src/run.ts:120-129`)
- AC-39 WHEN the CI Runs page opens or the author clicks Refresh, the CI Runs page shall call `POST /ci/sync` and then reload the run list. — `:134` — clear
- AC-40 WHEN `POST /ci/sync` is called, the API shall read, with the configured GitHub token, at most the 20 most recent completed runs of `devdigest-review.yml` in each installation's repository and download each run's `devdigest-result` artifact. — `:135` — clear
- AC-41 IF an artifact fails `CiResultArtifact` parsing, THEN the API shall reject it with reason `schema` and write no row for that run. — `:136` — clear
- AC-42 IF an artifact's `head_sha` differs from the head SHA GitHub reports for its workflow run, THEN … reason `head_sha_mismatch`. — `:137` — clear (R2 verification in Stage 4)
- AC-43 IF an artifact's `repository_id` differs from the id GitHub reports for the installation's repository, THEN … reason `repository_mismatch`. — `:138` — clear
- AC-44 IF an artifact archive exceeds 1 MB or holds no `devdigest-result.json`, THEN … reason `artifact_unreadable`. — `:139` — clear
- AC-45 WHEN an artifact passes every check, the API shall store one `agent_runs` row with `source` `ci`, the installation's agent, status `done`, `pr_id` null, model, duration, cost, findings count and blockers, plus its `run_traces` document with `config.source` `ci` and a `ci` block. — `:140` — clear
- AC-46 WHEN an artifact passes every check, the API shall store one `ci_runs` row with the installation, PR number, run time, status `succeeded` or `no_findings`, findings count, cost, `github_url` set to the workflow run's `html_url` from GitHub, and `source` `gha`. — `:141` — clear
- AC-47 IF a workflow run's `html_url` is already stored in `ci_runs`, THEN the API shall skip that run and write nothing. — `:142` — clear
- AC-48 IF a completed workflow run has no `devdigest-result` artifact, THEN the API shall store one `ci_runs` row with status `failed`, its `github_url`, null findings and cost, and no `agent_runs` row. — `:143` — clear
- AC-49 WHEN a sync ends, the API shall answer `ingested`, `skipped` and `failed` counts plus `rejected` entries with `run_url` and `reason`, and `errors` entries with `repo` and `message`. — `:144` — clear
- AC-50 IF a sync is already running in the workspace, THEN the API shall answer 409. — `:145` — clear
- AC-51 IF GitHub answers 401, 403 or 404 for one installation's repository, THEN the API shall list that repository in `errors` with GitHub's message and still sync the others. — `:146` — clear
- AC-52 IF no GitHub token is configured, THEN the API shall answer an error naming the missing GitHub token and write nothing. — `:147` — clear (`server/src/platform/container.ts:361-362` throws `GITHUB_TOKEN is not configured`)
- AC-53 The CI Runs page shall show one row per CI run, newest first, with repository, PR number, agent (`—` when the agent no longer exists), verdict, findings by severity, cost, duration, status and a link to the GitHub Actions run. — `:151` — clear (F2 for failed rows of a deleted agent)
- AC-54 The API shall return at most the 100 newest CI runs of the workspace from `GET /ci/runs`, filtered by `agent_id` when given. — `:152` — clear
- AC-55 WHILE the workspace has no CI run, the CI Runs page shall show the empty state "No CI runs yet". — `:153` — clear (key exists in `client/messages/en/ci.json`)
- AC-56 IF the sync answered `rejected` or `errors` entries, THEN the CI Runs page shall show a notice with their number and reasons. — `:154` — clear
- AC-57 The sidebar shall show a "CI Runs" item linking to `/ci-runs`. — `:155` — clear (key mapped at `client/src/components/app-shell/helpers.ts:38`; nav entry waits for A's GLOBAL group, Stage 7)
- AC-58 WHILE the agent has no installation, the CI tab shall show the empty state "Not in CI yet" with an "Add to CI" button. — `:159` — clear
- AC-59 The CI tab shall list each installation with its repository, GitHub Actions, the latest run's status and time, and the workflow version — the manifest version of the latest ingested run, `—` before the first — beside the agent's current version. — `:160` — clear
- AC-60 The API shall return, from `GET /agents/:id/ci/installations`, the agent's installations with `latest_run_status`, `latest_run_at` and `manifest_version`. — `:161` — clear
- AC-61 The CI tab shall show the agent's CI run history, newest first, at most 20 rows, with the columns of the CI Runs page. — `:162` — clear
- AC-62 WHEN the author picks Critical, Warning + or Never under Fail CI on, the CI tab shall send `PUT /agents/:id` with `ci_fail_on` `critical`, `warning` or `never`. — `:163` — clear (route exists `server/src/modules/agents/routes.ts:41`)
- AC-63 The CI tab shall state that a Fail CI on change reaches CI only after "Update CI config". — `:164` — clear
- AC-64 WHEN the author clicks "Update CI config", the CI tab shall open the Export to CI dialog with the installation's repository in the repository field. — `:165` — clear
- AC-65 WHEN the author exports an agent to `vklyovsa/devdigest-demo`, reviews and merges the export PR, and opens a same-repository test PR, the DevDigest Review workflow shall post the agent's result on the test PR. — `:169` — clear (manual; F1 risk)
- AC-66 WHILE Fail CI on is Critical and the DevDigest Review check is required by the branch rules, WHEN the test PR carries a CRITICAL finding, the DevDigest Review check shall end failed… — `:170` — clear (manual)
- AC-67 The GitHub Actions log and the `devdigest-result` artifact of the test run shall contain no `OPENROUTER_API_KEY` value. — `:171` — clear (manual)
- AC-68 WHEN the author refreshes CI Runs after the test run, the CI Runs page shall show the run with repository `vklyovsa/devdigest-demo`, the test PR number and the link to its GitHub Actions run. — `:172` — clear (manual)
- AC-69 The diff of worktree B against `feature/lab-07` shall change no file of worktree A's list and, among shared files, only the lines § Ownership and merge order names. — `:176` — clear (manual; see the second question for unlisted files)
- AC-70 WHEN worktree B has been updated from `feature/lab-07` after A's merge, the check commands of § Ownership and merge order shall pass. — `:177` — clear (manual)

NFR-1…NFR-11 (`:206-216`) and EC-1…EC-22 (`:181-202`) are covered through the criteria they name; NFR-1 (no migration), NFR-2 (dual copies, one `AgentManifest` owner), NFR-6 (six routes), NFR-8 (one log line per installation) and NFR-9 (plain text, `html_url` only from GitHub) shape steps directly.

## 2. Impact map
| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| server+client | `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts` | Modify | shared contracts (dual copy; `AgentManifest` server only) | 4–6, 14, 22, 25, 33, 40–49, 53–54, 60 |
| server+client | `server/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/contracts/trace.ts` | Modify | shared contracts (optional `ci` key only) | 45, 68 |
| agent-runner | `agent-runner/src/context.ts`, `artifact.ts`, `run.ts`, `index.ts` | Modify | runner | 33, 34 |
| agent-runner | `agent-runner/src/redact.ts` | New | runner helper | 34 |
| agent-runner | `agent-runner/src/run.test.ts` | Modify (fixture fields only) | existing test kept green | 33 |
| server | `server/src/modules/ci/{constants,types,helpers,manifest,workflow,bundle,repository,service,routes}.ts` | New | module: transport / application / persistence | 4–5, 14–32, 39–54, 60 |
| server | `server/src/vendor/shared/adapters.ts` | Modify (additions) | port `GitHubClient` | 17, 40–44, 51 |
| server | `server/src/adapters/github/octokit.ts` | Modify (additions) | adapter | 17, 40–44 |
| server | `server/src/adapters/mocks.ts` | Modify (additions) | test double | (later tests) |
| server | `server/src/platform/container.ts` | Modify (one import + getter) | composition root | all API |
| server | `server/src/modules/index.ts` | Modify (one import + entry) | module registry (shared file) | NFR-6 |
| server | `server/package.json`, `server/pnpm-lock.yaml` | Modify via `pnpm add yaml fflate` | dependency | 14, 22, 26–32, 44 |
| client | `client/src/lib/hooks/ci.ts` | New | data hooks | 4, 6, 12–13, 22, 39, 54, 60–61 |
| client | `client/messages/en/ci.json` | Modify | i18n | NFR-7 |
| client | `client/src/components/ci-runs/CiRunsTable/{CiRunsTable.tsx,index.ts,styles.ts,helpers.ts}` | New | cross-route component (`/ci-runs` + agent page) | 53, 61 |
| client | `client/src/app/ci-runs/page.tsx`, `client/src/app/ci-runs/_components/CiRunsView/{CiRunsView.tsx,index.ts,styles.ts}` | New | route + route-local view | 39, 53, 55, 56 |
| client | `client/src/app/agents/[id]/_components/AgentEditor/{AgentEditor.tsx,constants.ts}` | Modify | tab entry | 1, 58 |
| client | `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/{CiTab.tsx,index.ts,styles.ts,constants.ts}` | New | route-local tab | 58–64 |
| client | `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportWizard/{ExportWizard.tsx,index.ts,styles.ts,constants.ts,helpers.ts}` | New | owned by CiTab | 1–13 |
| client | `client/src/vendor/ui/nav.ts` | Modify (one item, after A merges) | shared file | 57 |

## 3. Constraints in play
- dependency-cruiser (`server/.dependency-cruiser.cjs`): `drizzle-only-in-repositories`, `schema-only-in-repositories` (Drizzle and `db/schema` only in `ci/repository.ts`), `no-row-types-in-transport`, `no-cross-module-internals` (no import of `agents/repository.ts`, `skills/repository.ts` or `reviews/*` internals; `ci/types.ts` declares consumer ports that `container.agentsRepo` / `container.skillsRepo` satisfy structurally), `no-service-to-container`, `no-adapter-to-module`, `no-circular`.
- Dual contracts (NFR-2): `eval-ci.ts` and `trace.ts` change identically in both copies; `AgentManifest` changes in the server copy only. The drift check is in section 6.
- No migration (NFR-1, NG-11): the last file stays `0019_skill_evals.sql`. Values without a column live in `run_traces.trace.ci`. `ci_runs` links to its `agent_runs` row through `run_traces.trace->'ci'->>'run_url' = ci_runs.github_url`.
- A's attribution contract (MI-15): B inserts no `reviews` / `findings` rows. `agent_runs.agent_id` = the installation's agent. `multi_agent_run_id` is never set, so A's nullable column defaults to null after the merge. B never edits `server/src/db/schema/runs.ts`.
- Do not touch A's paths: `server/src/modules/reviews/**`, `server/src/modules/multi-agent/**`, `server/src/db/schema/runs.ts`, `contracts/{observability,review-api,platform}.ts`, `client/src/app/repos/[repoId]/{pulls/[number],multi-agent}/**`, `client/src/lib/hooks/reviews.ts`. Also `reviewer-core/**` and `mcp/**`.
- Shared files, minimal lines only: `server/src/modules/index.ts` (one import, one entry `ci`), both `trace.ts` copies (optional `ci` only), `client/src/vendor/ui/nav.ts` (one item, Stage 7). `client/src/components/app-shell/navigation.test.tsx` is untouched in this run: the appended `it(...)` belongs to a later test-writer.
- i18n: every new string goes in `client/messages/en/ci.json`. The tab label reuses `agents.json` `editor.tabs.ci`; the sidebar label reuses `shell.json` `ci-runs`.
- Naming: kebab-case module files; PascalCase component folders with `index.ts`; snake_case on the wire.
- Lockfiles change only through `pnpm add` in `server/`. `agent-runner/dist/` is git-ignored (`agent-runner/.gitignore:40`) and is built, never committed.
- Implementers write no new tests. Existing suites must stay green; the only test edit allowed is fixture fields in `agent-runner/src/run.test.ts` (Stage 2).

## 4. Stages

### Stage 1 — Contracts (both copies)
Track: shared · After: —
Files: `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, `server/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/contracts/trace.ts`
Read first: `server/src/vendor/shared/contracts/eval-ci.ts:68-178` (the CI block to change), `client/src/vendor/shared/contracts/eval-ci.ts:1-10,80-150` (client copy, which lacks `AgentManifest`), `server/src/vendor/shared/contracts/trace.ts:86-105` (`RunTrace`), `server/src/vendor/shared/contracts/findings.ts:26-27` (`Verdict`)
Steps:
1. Server copy only: add `version: z.number().int().nullish()` to `AgentManifest`.
2. In both copies of `eval-ci.ts`, change these shapes identically:
   - `CiFile`: add `size_bytes: z.number().int()`.
   - `CiExportInput`:
     - `repo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.\.?$)[A-Za-z0-9._-]+$/)` (rejects `acme` and `../x`, AC-25).
     - `target: z.literal('gha').default('gha')`.
     - Delete `action`.
     - `triggers: z.array(z.enum(['opened','synchronize','reopened'])).min(1).default(['opened','synchronize'])`.
     - Add `workflow_yaml: z.string().max(100_000).nullish()`.
     - Keep `post_as` and `base`.
   - `CiInstallation`: add `latest_run_status: z.string().nullable()`, `latest_run_at: z.string().nullable()`, `manifest_version: z.number().int().nullable()`.
   - `CiRun`: add `repo: z.string()`, `agent_id: z.string().nullable()`, `verdict: Verdict.nullable()`, and `critical`, `warning`, `suggestion` as `z.number().int().nullable()`.
   - `CiResultArtifact`: add `head_sha: z.string().regex(/^[0-9a-f]{40}$/)`, `repository_id: z.number().int()`, `verdict: Verdict`, `blockers: z.number().int()`, `model: z.string()`, `manifest_version: z.number().int().nullable()`. Existing fields stay unchanged; keep the default strip, so unknown keys are dropped.
   - New `CiSyncResult`: `ingested`, `skipped`, `failed` as int; `rejected: z.array(z.object({ run_url: z.string(), reason: z.enum(['schema','head_sha_mismatch','repository_mismatch','artifact_unreadable']) }))`; `errors: z.array(z.object({ repo: z.string(), message: z.string() }))`. Export the schema and its type.
3. In both copies of `trace.ts`: add `import { Verdict } from './findings.js'` and `ci: z.object({ repo: z.string(), repository_id: z.number().int(), pr_number: z.number().int(), head_sha: z.string(), run_url: z.string(), manifest_version: z.number().int().nullable(), model: z.string(), runner_version: z.string().nullable(), verdict: Verdict, critical: z.number().int(), warning: z.number().int(), suggestion: z.number().int() }).optional()` on `RunTrace`. Touch no other line.
Skills: `zod` → `.claude/skills/zod/SKILL.md` — schema and inferred type share the name; `onion-architecture` → `rules/zod-contracts.md` § "Both copies must change".
Tests to add: none in this workflow. Later: AC-14 (manifest round trip), AC-25 (schema rejects `acme`, `../x`), AC-49 (shape against `CiSyncResult`).
Done when: `.claude/agents/scripts/check-code.sh server` and `.claude/agents/scripts/check-code.sh client` are green (agent-runner typecheck is expected red until Stage 2); `diff -u` of each pair shows only the drift that existed at `a8c0a3b` (section 6).

### Stage 2 — agent-runner: verifiable artifact, no secret output, build
Track: shared · After: 1
Files: `agent-runner/src/context.ts`, `agent-runner/src/artifact.ts`, `agent-runner/src/run.ts`, `agent-runner/src/index.ts`, `agent-runner/src/redact.ts` (New), `agent-runner/src/run.test.ts` (fixture only)
Read first: `agent-runner/src/run.ts:83-173`, `agent-runner/src/artifact.ts`, `agent-runner/src/context.ts:33-94`, `agent-runner/src/index.ts:25-62`, `agent-runner/src/run.test.ts:150-195` (event fixture and `baseDeps`), `reviewer-core/src/output/to-review.ts:150-165` (deterministic event)
Steps:
1. `context.ts`:
   - Extend `PullRequestEventPayload` with `pull_request.head.sha` and top-level `repository.id`.
   - `PrContext` gains `headSha: string` and `repositoryId: number`.
   - `resolvePrContext` throws `RunnerError` when `head.sha` is not 40 hex characters or `repository.id` is not a positive integer.
2. `artifact.ts`: `BuildResultArtifactInput` gains `headSha`, `repositoryId`, `verdict: Verdict`, `blockers`, `model`, `manifestVersion: number | null`. The candidate object writes `head_sha`, `repository_id`, `verdict`, `blockers`, `model`, `manifest_version` beside the existing keys (AC-33).
3. New `redact.ts`: `redactSecrets(text: string, secrets: (string | undefined)[]): string` replaces every non-empty value of 8 or more characters with `***`.
4. `run.ts`:
   - Map `payload.event` to a verdict: `APPROVE→approve`, `REQUEST_CHANGES→request_changes`, `COMMENT→comment`.
   - Pass `ctx.headSha`, `ctx.repositoryId`, the verdict, `blockers`, `manifest.model` and `manifest.version ?? null` to `buildResultArtifact`.
   - Before posting, pass `payload.body` and each `payload.comments[].body` through `redactSecrets` with `[deps.env.OPENROUTER_API_KEY, deps.env.GITHUB_TOKEN]`, and do the same in the `catch` for the error message (AC-34).
   - Keep the single try/catch and the `artifact === null` narrowing.
5. `index.ts`: no new output paths; the failure line prints the already-redacted `result.error`.
6. `run.test.ts`: add only `head: { sha: 'a'.repeat(40), repo: { fork: false } }` and `repository: { id: 1 }` to the existing event fixture so current tests stay green. Add no new `it`.
7. Build: `cd agent-runner && pnpm build` (ncc). Ignore `ERR_PNPM_IGNORED_BUILDS` if `dist/index.js` was written; never answer approve-builds; delete any `agent-runner/pnpm-workspace.yaml` stub pnpm creates. Record `ls agent-runner/dist` in the report: if anything besides `index.js` appears (for example `310.index.js` or `package.json`), name it under "Not done / blockers" for F1. Do not add files to the export.
Skills: `security` → `.claude/skills/security/SKILL.md` — no secret values in logs or posted output (by content: `token`, `secret`); `typescript-expert` → `.claude/skills/typescript-expert/SKILL.md` — keep the discriminated union narrowing on `artifact === null`.
Tests to add: none. Later: AC-33 (key set, values from the event), AC-34 (sentinel values absent from console, artifact and post bodies), AC-35…AC-38 (already covered by `run.test.ts`).
Done when: `cd agent-runner && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run` is green; `agent-runner/dist/index.js` exists; `git status --porcelain agent-runner` lists only `src/` files.

### Stage 3 — server: export side (preview, export to PR, zip, installations)
Track: server · After: 1, 2 (needs `dist/index.js` for manual checks only)
Files: `server/src/modules/ci/constants.ts`, `types.ts`, `helpers.ts`, `manifest.ts`, `workflow.ts`, `bundle.ts`, `repository.ts`, `service.ts`, `routes.ts` (all New); `server/src/vendor/shared/adapters.ts`, `server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts`, `server/src/platform/container.ts`, `server/src/modules/index.ts`, `server/package.json`, `server/pnpm-lock.yaml`
Read first:
- `server/src/modules/eval/routes.ts:1-60` (route shape: schema, `getContext`, one service call)
- `server/src/modules/eval/types.ts:188-252` (consumer ports over shared repos)
- `server/src/platform/container.ts:200-210,290-306,355-365` (repo and service getters, `github()`)
- `server/src/modules/skills/repository.ts:108-127` (`linkedEnabled`)
- `server/src/modules/agents/repository.ts:54-76` (`getById`)
- `server/src/adapters/github/octokit.ts:253-357` (`commitFiles`, `openPullRequest`, `findOpenPr`)
- `server/src/vendor/shared/adapters.ts:98-180,308-322` (GitHub port, `SecretsProvider`)
- `server/src/adapters/mocks.ts:123-140,220-235` (GitHub mock)
- `server/src/platform/errors.ts`
- `server/src/db/schema/ci.ts`, `server/src/db/schema/knowledge.ts:21-45` (`memory`)
- `server/src/modules/index.ts`
- reference, port allowed: `git show base/full-functionality:server/src/modules/ci/manifest.ts` and `…/memory-export.ts`
Steps:
1. Dependencies: `cd server && pnpm add yaml fflate`. Ignore `ERR_PNPM_IGNORED_BUILDS` if `grep -E '"(yaml|fflate)"' server/package.json` and the lockfile show both. If pnpm changed `server/pnpm-workspace.yaml`, edit it back to its committed content (`git diff server/pnpm-workspace.yaml` must be empty).
2. R3, verify before writing `PINNED_ACTIONS`: `gh api repos/actions/checkout/commits/v4 --jq .sha`, `gh api repos/actions/setup-node/commits/v4 --jq .sha`, `gh api repos/actions/upload-artifact/commits/v4 --jq .sha`. Store the three 40-character SHAs with a `// v4` comment.
3. `constants.ts`:
   - `CI_BRANCH = 'devdigest/ci'`, `WORKFLOW_FILE = 'devdigest-review.yml'`, `WORKFLOW_PATH = '.github/workflows/devdigest-review.yml'`, `RUNNER_PATH = '.devdigest/runner/index.js'`, `MEMORY_PATH = '.devdigest/memory.jsonl'`, `AGENTS_DIR = '.devdigest/agents/'`.
   - `ARTIFACT_NAME = 'devdigest-result'`, `RESULT_FILE = 'devdigest-result.json'`, `PR_TITLE = 'Add DevDigest CI review'`, `COMMIT_MESSAGE`, `PR_BODY`.
   - `PINNED_ACTIONS` (step 2).
   - `DEFAULT_RUNNER_BUNDLE = fileURLToPath(new URL('../../../../agent-runner/dist/index.js', import.meta.url))`.
   - `SCANNED_SECRET_KEYS = ['OPENROUTER_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','GITHUB_TOKEN']`.
   - `SYNC_RUN_LIMIT = 20`, `ARTIFACT_MAX_BYTES = 1_048_576`, `RUN_LIST_LIMIT = 100`.
4. `types.ts`, the ports (no row types):
   - `CiAgentsReader { getById(workspaceId, id): Promise<{ id; name; provider; model; systemPrompt; strategy; ciFailOn; version } | undefined> }`, satisfied by `container.agentsRepo`.
   - `CiSkillsReader { linkedEnabled(agentId): Promise<{ id; name; body }[]> }`, satisfied by `container.skillsRepo`.
   - `CiStore`: the repository methods of steps 9 and Stage 4.
   - `CiDeps { store; agents; skills; secrets: SecretsProvider; github(): Promise<GitHubClient>; log: { info(obj, msg) }; runnerBundlePath?: string }`.
5. `manifest.ts`: port the reference `buildAgentManifest` / `renderAgentManifestYaml` (yaml `stringify`). Add `version: agent.version`; the path is `.devdigest/agents/${slugify(agent.name) || 'agent'}.yaml` (AC-14).
6. `workflow.ts`: fresh, ~60 lines. Build a plain object and `stringify(obj, { lineWidth: 0 })`:
   - `name: DevDigest Review`.
   - `on.pull_request.types`: the selected triggers, filtered to the closed set in fixed order (AC-26).
   - Top-level `permissions: { contents: read, pull-requests: write }` (AC-27).
   - Job `review` on `ubuntu-latest`, steps:
     1. checkout `actions/checkout@<sha>` with `ref: ${{ github.event.pull_request.base.sha }}` and `persist-credentials: false` (AC-29).
     2. `actions/setup-node@<sha>` with `node-version: '22'`.
     3. "DevDigest review": `run: node .devdigest/runner/index.js`, `env: { OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}, GITHUB_TOKEN: ${{ github.token }}, PR_NUMBER: ${{ github.event.pull_request.number }}, DEVDIGEST_POST_AS: <post_as> }` (AC-30, AC-31).
     4. Upload: `if: always()`, `actions/upload-artifact@<sha>` with `name: devdigest-result`, `path: devdigest-result.json`, `if-no-files-found: ignore` (AC-32).
   - `post_as` is re-checked against the closed set. No expression of title, body, head ref or comment appears anywhere.
7. `helpers.ts` (pure):
   - `slugify(name)`: lowercase, runs of non `[a-z0-9]` become `-`, dashes trimmed.
   - `uniqueSkillSlugs(skills)` (collision gets `-2`, `-3`).
   - `memoryJsonl(rows)`: one `JSON.stringify({ kind, scope, content })` per line plus `\n`, `''` for none (AC-24).
   - `toCiFile(path, contents, editable)`: adds `size_bytes = Buffer.byteLength`.
   - `findSecretFile(files, values)`: path of the first file containing a value of 8 or more characters, else null.
   - `zipFiles(files)` via fflate `zipSync` + `strToU8`.
   - `toPreviewFiles(files)`: runner contents `''`, `editable: false`.
   - DTO mappers `toInstallationDto` and `toCiRunDto`.
8. `bundle.ts`: `buildFiles({ agent, skills, memory, triggers, postAs, runner: { contents } })` returns `CiFile[]` in this order: manifest, skills (`.devdigest/skills/<slug>.md`, body as is), `memory.jsonl`, `RUNNER_PATH`, `WORKFLOW_PATH`. Only the workflow is `editable: true` (AC-4, AC-5).
9. `repository.ts` (`CiRepository implements CiStore`, Drizzle only here):
   - `findInstallationForRepo(workspaceId, repo)`: joins `agents` for workspace scope.
   - `upsertInstallation(agentId, repo)`: select by (agentId, repo), then update `installed_at = now()` or insert with `target_type 'gha'` (AC-18).
   - `listInstallationsForAgent(agentId)`: per installation, its newest `ci_runs` row (status, `ran_at`) and `manifest_version` from the newest matching trace (`run_traces.trace->'ci'->>'run_url' = ci_runs.github_url`).
   - `globalMemory(workspaceId)`: `kind`, `scope`, `content` where `scope = 'global'`.
10. `service.ts` (`CiService`, constructor `(deps: CiDeps)`):
    - `assemble(workspaceId, agentId, input)`:
      - agent or 404;
      - read the runner bundle (`readFileSync`); missing file → `AppError('runner_bundle_missing', 'Runner bundle not found at <path>. Run: cd agent-runner && pnpm build', 409)` (AC-21);
      - skills, memory, `buildFiles`;
      - replace the workflow's contents with `input.workflow_yaml` when given (AC-6);
      - secret scan with `await secrets.get(k)` for `SCANNED_SECRET_KEYS` → `ValidationError('Generated file <path> contains a secret value')` (AC-20).
    - `preview` → `{ files: toPreviewFiles(files) }`.
    - `exportToGithub`:
      - other agent's installation on the repo → `AppError('ci_repo_taken', …, 409)` before any GitHub call (AC-19);
      - `assemble`;
      - `const gh = await deps.github()` (missing token: ConfigError names `GITHUB_TOKEN`);
      - `commitFiles({ branch: CI_BRANCH, base, message, files, prune: [AGENTS_DIR] })`;
      - `findOpenPr` ?? `openPullRequest({ title: PR_TITLE, head: CI_BRANCH, base, body })`;
      - any GitHub throw → `ExternalServiceError(err.message)` (502) with no installation stored (AC-23);
      - then `upsertInstallation` → `CiExport { installation, files: toPreviewFiles(files), pr_url }` (AC-15, AC-16).
    - `zip`: the same 409 check and `assemble`, then `upsertInstallation`; returns a `Buffer` (AC-22, AC-18).
    - `listInstallations(workspaceId, agentId)`: agent 404 check, then DTOs (AC-60).
11. `routes.ts` (four routes now; the two sync routes come in Stage 4). Each declares Zod schemas, calls `getContext`, then makes one service call:
    - `POST /agents/:id/ci/preview`: body `CiExportInput.pick({ repo: true, triggers: true, post_as: true })`.
    - `POST /agents/:id/export-ci`: body `CiExportInput`, response `CiExport`.
    - `POST /agents/:id/ci/zip`: body `CiExportInput`; `reply.header('content-type','application/zip').header('content-disposition','attachment; filename="devdigest-ci.zip"').send(buf)`.
    - `GET /agents/:id/ci/installations`: response `z.array(CiInstallation)`.
    - Routes resolve `app.container.ciService` only.
12. `adapters.ts`: add `prune?: string[]` to `CommitFilesPayload` (path prefixes whose blobs are deleted unless rewritten).
13. `octokit.ts` `commitFiles`: when `payload.prune` is set, read the parent tree recursively (`g.getTree({ tree_sha, recursive: 'true' })`). For each blob path that starts with a prefix and is not in `payload.files`, add `{ path, mode: '100644', type: 'blob', sha: null }` to the tree entries (AC-17, EC-5). This is the only change to existing code in this file.
14. `container.ts`: one import plus a `get ciService()` that passes `store: new CiRepository(this.db)` (cached), `agents: this.agentsRepo`, `skills: this.skillsRepo`, `secrets: this.secrets`, `github: () => this.github()`, `log: this.logger`. `modules/index.ts`: `import ci from './ci/routes.js'` and a `ci` entry.
15. R1, note only: the studio's GitHub token needs `repo` + `workflow` (classic), or Contents RW, Pull requests RW, Workflows RW, Actions R (fine-grained). Without `workflow` GitHub refuses the commit and the export answers 502 (EC-7). Do not read `~/.devdigest/secrets.json`.
Skills:
- `onion-architecture` → `rules/fastify-transport.md` § "A route does exactly four things"; `rules/ports-and-di.md` § "Inject ports, not the container"; `rules/layers.md` § Cross-module rules (consumer ports over `container.agentsRepo` / `skillsRepo`); `rules/errors.md` (AppError subclasses only).
- `fastify-best-practices` → `rules/routes.md`, `rules/schemas.md` (route-level Zod, response schemas), `rules/content-type.md` (zip reply).
- `drizzle-orm-patterns` → `.claude/skills/drizzle-orm-patterns/SKILL.md`: joins and the jsonb `sql` fragment stay in `repository.ts`.
- `zod` → `.claude/skills/zod/SKILL.md`.
- `security` → `.claude/skills/security/SKILL.md`: `repo` regex before an outgoing URL, secret scan, `workflow_yaml` committed as content only.
Tests to add: none. Later: AC-14, 15, 16, 17, 20, 21, 22, 23, 24, 25 (unit); 26–32 (unit on `workflow.ts`); 18, 19 (integration).
Done when: `.claude/agents/scripts/check-code.sh server` is green (depcruise included), and `grep -rnE "drizzle-orm|db/schema" server/src/modules/ci/ | grep -v repository.ts` prints nothing.

### Stage 4 — server: sync and run lists
Track: server · After: 3
Files: `server/src/modules/ci/{repository,service,routes,helpers,types}.ts`, `server/src/vendor/shared/adapters.ts`, `server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts`
Read first: `server/src/db/schema/runs.ts:8-41` (`agent_runs`, `run_traces`; read only, A's file), `server/src/db/schema/ci.ts`, `server/src/vendor/shared/contracts/trace.ts:86-110`, `server/src/adapters/github/octokit.ts:1-40` (Octokit wrapper pattern: `withRetry`, `withTimeout`), `server/src/adapters/mocks.ts:123-140`, plus the files Stage 3 wrote
Steps:
1. `adapters.ts`: add `WorkflowRunSummary { id: number; htmlUrl: string; headSha: string; prNumber: number | null; startedAt: string }` and `RunArtifactSummary { id: number; name: string; sizeInBytes: number; expired: boolean }`. Add to `GitHubClient`:
   - `getRepositoryId(repo): Promise<number>`
   - `listCompletedWorkflowRuns(repo, workflowFile, limit): Promise<WorkflowRunSummary[]>`
   - `listRunArtifacts(repo, runId): Promise<RunArtifactSummary[]>`
   - `downloadArtifact(repo, artifactId): Promise<Uint8Array>`
2. `octokit.ts`, the new methods, each wrapped in `withRetry` / `withTimeout`:
   - `getRepositoryId`: `rest.repos.get` → `data.id`.
   - `listCompletedWorkflowRuns`: `rest.actions.listWorkflowRuns({ workflow_id: workflowFile, status: 'completed', per_page: limit })`; `prNumber` from `pull_requests[0]?.number ?? null`; `startedAt` from `run_started_at ?? created_at`.
   - `listRunArtifacts`: `rest.actions.listWorkflowRunArtifacts`.
   - `downloadArtifact`: `rest.actions.downloadArtifact({ archive_format: 'zip' })` → `new Uint8Array(data as ArrayBuffer)`.
   - `mocks.ts`: matching methods driven by new optional `MockGitHubOptions` fields (`repositoryId`, `workflowRuns`, `artifacts` by run id, `artifactZips` by artifact id); additions only.
3. R2, verify once on the demo repository after a real run exists (or record "not yet possible"): `gh api repos/vklyovsa/devdigest-demo/actions/runs --jq '.workflow_runs[] | select(.event=="pull_request") | {head_sha, pr: .pull_requests[0].number}'` against `gh api repos/vklyovsa/devdigest-demo/pulls/<n> --jq .head.sha`. They must match for AC-42 to pass on real data.
4. `repository.ts`:
   - `listGhaInstallations(workspaceId)`: installation, repo, agentId, agent name.
   - `ciRunExists(githubUrl)`.
   - `insertFailedRun({ installationId, prNumber, ranAt, githubUrl })`: status `failed`, `source 'gha'`, null findings and cost (AC-48).
   - `insertIngestedRun({ workspaceId, agentId, installationId, artifact, run, repo, repositoryId })`: one `db.transaction`, so nothing partial is stored (MI-14), inserting:
     - `agent_runs`: `source 'ci'`, `status 'done'`, `prId` null, `ranAt = run.startedAt`, `provider 'openrouter'`, `model`, `durationMs`, `costUsd`, `findingsCount`, `blockers`; tokens, grounding and score null.
     - `run_traces`: a full `RunTrace` with `config { agent, version: manifest_version?.toString() ?? null, provider: 'openrouter', model, pr: pr_number, source: 'ci' }`, `stats { duration_ms, tokens_in: 0, tokens_out: 0, cost_usd, findings, grounding: '' }`, `prompt_assembly { system: '', user: '' }`, empty arrays, `raw_output: ''`, and `ci { repo, repository_id, pr_number, head_sha, run_url: run.htmlUrl, manifest_version, model, runner_version: artifact.version ?? null, verdict, critical, warning, suggestion }`.
     - `ci_runs`: status `findings_count > 0 ? 'succeeded' : 'no_findings'`, `githubUrl = run.htmlUrl`, `source 'gha'` (AC-45, AC-46, EC-18).
   - `listRuns(workspaceId, agentId | undefined, limit)`:
     - Joins: `ci_runs` LEFT JOIN `ci_installations` LEFT JOIN `agents`, LEFT JOIN `run_traces` ON `trace->'ci'->>'run_url' = ci_runs.github_url`, LEFT JOIN `agent_runs` ON `run_traces.run_id`.
     - Filter: `agents.workspace_id = ws OR agent_runs.workspace_id = ws`, optional `agent_id` on either side.
     - Order and size: `ORDER BY ran_at DESC NULLS LAST`, `LIMIT limit` (AC-54).
     - Fields: `repo` = installation repo ?? `trace.ci.repo`; `agent` = agent name or null (the UI renders `—`, EC-19); `duration_s` = `duration_ms / 1000`.
5. `service.ts`:
   - `listRuns(workspaceId, agentId)`: `RUN_LIST_LIMIT`.
   - `sync(workspaceId)`:
     - Concurrency: a `Set<string>` of running workspace ids → `AppError('ci_sync_running', …, 409)` (AC-50). Release it in `finally`.
     - `const gh = await deps.github()` first, so a missing token writes nothing (AC-52).
     - Per installation, in a try/catch that pushes `{ repo, message: err.message }` into `errors` and continues (AC-51): `repoId = getRepositoryId`, then each run of `listCompletedWorkflowRuns(repo, WORKFLOW_FILE, SYNC_RUN_LIMIT)` (AC-40):
       - `ciRunExists(htmlUrl)` → `skipped++` (AC-47).
       - No non-expired `devdigest-result` artifact → `insertFailedRun`, `failed++` (AC-48, EC-14).
       - `sizeInBytes > ARTIFACT_MAX_BYTES`, or downloaded length over the cap, or no `devdigest-result.json` entry (fflate `unzipSync` with a filter on that name and `originalSize`) → reject `artifact_unreadable` (AC-44).
       - JSON parse or `CiResultArtifact.safeParse` failure → `schema` (AC-41).
       - `head_sha !== run.headSha` → `head_sha_mismatch` (AC-42).
       - `repository_id !== repoId` → `repository_mismatch` (AC-43).
       - Otherwise `insertIngestedRun`, `ingested++`.
     - After each installation: `deps.log.info({ repo, ingested, skipped, failed, rejected }, 'ci sync')`, counts only (NFR-8).
     - Answer a `CiSyncResult` (AC-49).
6. `routes.ts`: `GET /ci/runs` (querystring `z.object({ agent_id: z.string().uuid().optional() })`, response `z.array(CiRun)`) and `POST /ci/sync` (response `CiSyncResult`). That makes six routes in the module (NFR-6).
Skills: `onion-architecture` → `rules/drizzle-persistence.md` § "Row types do not cross the repository boundary" (DTO mapping in `helpers.ts`; the transaction inside `insertIngestedRun` follows the repo's accepted precedent, flagged for review) and `rules/ports-and-di.md` § "Adding a new external capability" (port → mock → use case → adapter); `drizzle-orm-patterns` → `SKILL.md` (LEFT JOINs, jsonb `sql` fragment); `fastify-best-practices` → `rules/schemas.md`; `security` → `SKILL.md` (archive size cap before and after download; `github_url` from GitHub's `html_url`, never from the artifact, NFR-9).
Tests to add: none. Later: AC-40, 41, 42, 43, 44, 49, 50, 51, 52, NFR-8 (unit with `MockGitHubClient`); AC-45, 46, 47, 48, 54, 60 (integration, `*.it.test.ts`); NFR-4 (mock LLM call count 0).
Done when: `.claude/agents/scripts/check-code.sh server` is green; `grep -rn "app\.\(get\|post\|put\|delete\)(" server/src/modules/ci/routes.ts | wc -l` prints 6.

### Stage 5 — client: CI hooks, messages, shared run table, CI Runs page
Track: client · After: 1
Files: `client/src/lib/hooks/ci.ts` (New), `client/messages/en/ci.json`, `client/src/components/ci-runs/CiRunsTable/{CiRunsTable.tsx,index.ts,styles.ts,helpers.ts}` (New), `client/src/app/ci-runs/page.tsx` (New), `client/src/app/ci-runs/_components/CiRunsView/{CiRunsView.tsx,index.ts,styles.ts}` (New)
Read first: `client/src/lib/hooks/evals.ts:1-60` (query keys, mutation pattern), `client/src/lib/api.ts` (`api`, `API_BASE`, `ApiError`), `client/src/app/eval/page.tsx` (thin page), `client/src/vendor/ui/primitives/EmptyState.tsx`, `client/messages/en/ci.json`, `client/src/vendor/shared/contracts/eval-ci.ts` (after Stage 1)
Steps:
1. `hooks/ci.ts` (`"use client"`, `import type` only):
   - `ciKeys`: `installations(agentId)`, `runs(agentId | 'all')`.
   - `useCiInstallations(agentId)`, `useCiRuns(agentId?)`.
   - `useCiPreview()`: POST preview → `{ files }`.
   - `useExportCi()`: POST export-ci → `CiExport`; invalidates installations and runs.
   - `useDownloadCiZip()`: a mutation doing `fetch(`${API_BASE}/agents/${id}/ci/zip`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })`; on `!res.ok` it throws `ApiError` from the JSON error body; otherwise blob → object URL → temporary `<a download="devdigest-ci.zip">` click → revoke. This is the only raw `fetch`, kept in the hooks layer, because `api.ts` parses JSON only.
   - `useCiSync()`: POST `/ci/sync` → `CiSyncResult`; on settle it invalidates runs and installations.
2. `ci.json`: extend under the existing namespace:
   - `runs`: column labels `repository`, `pr`, `agent`, `verdict`, `findings`, `cost`, `duration`, `status`, `run`; `agentMissing: "—"`; `syncNotice: "{count, number} runs could not be synced"`; reason labels for the four reasons; `errorRetry`.
   - Remove the now-unused `autoRefresh` and `filters` only if nothing references them (`grep -rn "autoRefresh\|filters\." client/src`).
3. `CiRunsTable` (cross-route, used in Stages 5 and 6): props `runs: CiRun[]`.
   - Native `<table>` with columns repository, `#pr`, agent (`—` when `agent` is null), verdict, C/W/S counts, cost, duration, status, and `<a href={github_url} target="_blank" rel="noopener noreferrer">` (AC-53).
   - All values render as React text (NFR-9).
   - Grid and cell styles per section 0 (`minmax(0, 1fr)`, `overflowWrap`).
4. `CiRunsView`:
   - `useCiRuns()` plus `useCiSync()`; on mount call `sync.mutate()` once (ref guard).
   - The Refresh `Button` calls it again and is disabled while `sync.isPending` (AC-39).
   - Empty state `runs.emptyTitle` "No CI runs yet" (AC-55).
   - A notice when `rejected.length + errors.length > 0`, listing each reason or repo message as text (AC-56).
   - The list error shows a retry.
5. `page.tsx`: thin, renders `<CiRunsView />`.
Skills: `next-best-practices` → `file-conventions.md` (thin `page.tsx`, client boundary in the view); `frontend-ui-architecture` → `placement.md` § Components (route-local view under `_components/`, the table in `src/components/ci-runs/` because two routes render it) and `devdigest.md`; `react-best-practices` → `SKILL.md` (no fetch in components; effect for the one-shot sync).
Tests to add: none. Later: AC-39, 53, 55, 56, NFR-9 (component, `CiRunsView.test.tsx`, `CiRunsTable.test.tsx`).
Done when: `.claude/agents/scripts/check-code.sh client` is green.

### Stage 6 — client: agent CI tab and Export Wizard
Track: client · After: 5
Files: `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `…/AgentEditor/_components/CiTab/{CiTab.tsx,index.ts,styles.ts,constants.ts}` (New), `…/AgentEditor/_components/CiTab/_components/ExportWizard/{ExportWizard.tsx,index.ts,styles.ts,constants.ts,helpers.ts}` (New), `client/messages/en/ci.json`
Read first:
- `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`, `constants.ts`
- `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx:1-40` and its `styles.ts` (tab pattern)
- `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx:1-50` (which hook modules the existing test mocks; the new tab must not render outside `tab === 'ci'`)
- `client/src/lib/hooks/agents.ts:50-78` (`useUpdateAgent`)
- `client/src/lib/repo-context.tsx:55-70` (`useActiveRepo`)
- `client/src/vendor/ui/kit/Modal.tsx`, `client/src/vendor/ui/ExportWizardSteps.tsx`
Steps:
1. `constants.ts`: append `{ key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" }` to `TABS` (the label exists in `agents.json`). `AgentEditor.tsx`: a `tab === "ci"` branch rendering `<CiTab key={agent.id} agent={agent} />`.
2. `CiTab`:
   - `useCiInstallations(agent.id)`, `useCiRuns(agent.id)`.
   - No installation → `EmptyState` "Not in CI yet" plus an "Add to CI" `Button` (AC-58).
   - Otherwise one row per installation: repo, "GitHub Actions", latest status and time, "Workflow v{manifest_version}" or `—`, beside "current v{agent.version}" (AC-59), and an "Update CI config" button that opens the wizard with `initialRepo = installation.repo` (AC-64).
   - "Fail CI on": three native `<input type="radio" name="ci-fail-on">` with labels Critical, Warning +, Never; `checked` = `agent.ci_fail_on === value` (`any` checks none, EC-22); `onChange` → `useUpdateAgent().mutate({ id, patch: { ci_fail_on } })` (AC-62). On error, revert and show the message (MI-7).
   - The note text from `ci.json` (AC-63).
   - History: `<CiRunsTable runs={(runs.data ?? []).slice(0, 20)} />` (AC-61).
3. `ExportWizard` (`Modal`, local step state 0–3, `ExportWizardSteps` with the four labels, AC-1):
   - **Target**: one selected target card, GitHub Actions only (AC-2). Native labelled `<input>` for the repo, prefilled with `initialRepo ?? activeRepo?.full_name ?? ""`. Continue disabled unless `REPO_RE` matches; `REPO_RE` is the contract regex copied locally in `constants.ts` (AC-3).
   - **Preview**: on entry, call `useCiPreview` with `{ repo, triggers, post_as }`. List each file with path and `size_bytes`. The workflow shows in a `<textarea aria-label>`; editing it sets `editedWorkflow` (AC-5). Other files are read-only `<pre>`; the runner shows path and size only (AC-4, AC-5). A preview error shows the API message and keeps Continue disabled (MI-1).
   - **Configure**: three native checkboxes `opened` / `synchronize` / `reopened`, the first two checked; Continue disabled when none is checked (AC-7, AC-8). Three radios for post as, GitHub review checked (AC-7). The static secret instruction naming `OPENROUTER_API_KEY` with no status (AC-9). The block-merge note (AC-10): rewrite `exportWizard.blockMergeDesc` to the design's "no GitHub App" wording.
   - **Install**: two radios, "Open a PR with these files" checked and "Download zip" (AC-11). Install sends `{ repo, triggers, post_as, workflow_yaml: editedWorkflow ?? undefined }` (AC-6). PR success shows `<a href={pr_url}>` (AC-12). An error shows `error.message` and leaves the zip option enabled (AC-13).
   - Local tuples `TRIGGERS`, `POST_AS`, `FAIL_ON_OPTIONS` sit in `constants.ts`, guarded with `Exclude<…>` against the contract types.
4. `ci.json`: add the keys for the tab (empty state, Add to CI, Update CI config, Fail CI on labels, the note, workflow and current version labels, history heading) and the wizard (target card, file sizes, secret instruction, install options, PR link, zip). Every visible string comes from there (NFR-7).
Skills: `frontend-ui-architecture` → `placement.md` § "Sub-component ownership" (`ExportWizard` under `CiTab/_components/`) and § Constants; `react-best-practices` → `SKILL.md` (controlled inputs, no derived state in effects); `security` → `SKILL.md` (no `dangerouslySetInnerHTML`; `pr_url` comes from the API).
Tests to add: none. Later: AC-1…AC-13 (`ExportWizard.test.tsx`), AC-58, 59, 61, 62, 63, 64, NFR-11 (`CiTab.test.tsx`).
Done when: `.claude/agents/scripts/check-code.sh client` is green, including the existing `AgentEditor.test.tsx`.

### Stage 7 — join: sidebar item after A has merged
Track: join · After: 3–6, and worktree B updated from `feature/lab-07` once A has merged
Files: `client/src/vendor/ui/nav.ts`
Read first: `client/src/vendor/ui/nav.ts` (the GLOBAL group as A left it)
Steps:
1. Append `{ key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs" }` to the GLOBAL group A added. Edit no other entry (spec § Ownership and merge order).
2. Resolve conflicts only in the shared files (`server/src/modules/index.ts`, both `trace.ts` copies, `nav.ts`; also `server/src/platform/container.ts` if A also appended a getter).
3. Re-run the AC-70 checks (section 6).
Skills: `frontend-ui-architecture` → `devdigest.md` (nav registry stays in `vendor/ui/nav.ts`).
Tests to add: none. Later: AC-57, one `it(...)` appended to `client/src/components/app-shell/navigation.test.tsx`.
Done when: the AC-70 rows of section 6 are green, and `git diff --name-only feature/lab-07` lists no path of A's list.

## 5. Skills matrix
| Stage | onion-architecture | fastify-best-practices | drizzle-orm-patterns | zod | security | typescript-expert | next-best-practices | react-best-practices | frontend-ui-architecture |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `rules/zod-contracts.md` | — | — | `SKILL.md` | — | — | — | — | — |
| 2 | — | — | — | — | `SKILL.md` | `SKILL.md` | — | — | — |
| 3 | `rules/fastify-transport.md`, `rules/ports-and-di.md`, `rules/layers.md`, `rules/errors.md` | `rules/routes.md`, `rules/schemas.md`, `rules/content-type.md` | `SKILL.md` | `SKILL.md` | `SKILL.md` | — | — | — | — |
| 4 | `rules/drizzle-persistence.md`, `rules/ports-and-di.md` | `rules/schemas.md` | `SKILL.md` | — | `SKILL.md` | — | — | — | — |
| 5 | — | — | — | — | — | — | `file-conventions.md` | `SKILL.md` | `placement.md`, `devdigest.md` |
| 6 | — | — | — | — | `SKILL.md` | — | — | `SKILL.md` | `placement.md` |
| 7 | — | — | — | — | — | — | — | — | `devdigest.md` |

## 6. Verification
| Package | Command (from the repository root) | Proves |
|---|---|---|
| server | `.claude/agents/scripts/check-code.sh server` | typecheck, depcruise rules of section 3, unit lane green (NFR-3) |
| client | `.claude/agents/scripts/check-code.sh client` | typecheck incl. `*.test.tsx`, existing component tests green (NFR-3) |
| agent-runner | `cd agent-runner && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run` | runner compiles against the new contracts; AC-35…AC-38 suites still green |
| agent-runner | `cd agent-runner && pnpm build && ls dist` | `dist/index.js` exists for export (AC-21); the file list feeds F1 |
| contracts | `diff -u server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts` and the same for `trace.ts` | hunks only at the base drift (`import` line, the `AgentManifest` block now with `version`, `ConformanceInput.provider`; `trace.ts` comment lines), NFR-2 |
| server | `ls server/src/db/migrations` | nothing after `0019_skill_evals.sql` (NFR-1) |
| all | `git diff --name-only a8c0a3b -- reviewer-core mcp` | empty (NFR-3, NG-7) |
| server | `grep -rnE "drizzle-orm\|db/schema" server/src/modules/ci/ \| grep -v repository.ts` | empty: persistence stays in the repository |
| manual | start API :3021 (`devdigest_ci`) and web :3020; Add to CI → Preview → Configure → Install on `vklyovsa/devdigest-demo`; merge the export PR; open a same-repo test PR carrying a CRITICAL; Refresh CI Runs | AC-65, AC-66 (with Fail CI on Critical + a required check), AC-67 (search the log and artifact for the key prefix), AC-68 (`GET /runs/:id/trace` shows the test PR head SHA in `ci`) |
| join | after updating from `feature/lab-07`: the three package rows above, then `git -C ../devdigest-review diff --name-only` ∩ `git diff --name-only` | AC-69, AC-70 |

Later test-writer coverage (not scheduled in this run):
- component: AC-1…AC-13, AC-39, AC-53, AC-55…AC-59, AC-61…AC-64, NFR-7, NFR-9 (UI), NFR-11
- unit: AC-14…AC-17, AC-20…AC-44, AC-49…AC-52, NFR-8, NFR-9 (`github_url`)
- integration: AC-18, AC-19, AC-45…AC-48, AC-54, AC-60, NFR-4

## 7. Risks and open questions
- [non-blocking] [→ spec-creator] F1 [conflict], AC-4, AC-5, AC-21, AC-22 and the spec's fixed runner path vs `agent-runner/src/index.ts:66-69` (`import.meta.url`, ESM output). The spec ships a single `.devdigest/runner/index.js`. The reference build of nearly the same runner (`git show base/full-functionality:agent-runner/dist/package.json` → `{"type":"module"}`, plus a lazy `310.index.js` holding only the node-fetch / DOMException polyfills) produced three files. The plan follows the spec as written and relies on Node 22's ESM syntax detection (`setup-node` 22). This breaks if the target repo's root `package.json` says `"type": "commonjs"`, or if a code path loads the chunk. If AC-65 fails at runner start, the change (also shipping `.devdigest/runner/package.json` and chunks) changes AC-4's file list and needs a spec revision. Stage 2 records `ls agent-runner/dist`.
- [non-blocking] [→ spec-creator] F2 [silent], EC-19 / AC-53. `ci_installations` and `ci_runs` carry no workspace column (`server/src/db/schema/ci.ts:4-26`), and deleting an agent cascades its installation, so the `ci_runs` row loses its installation. The plan scopes `GET /ci/runs` through the installation's agent or the linked `agent_runs` row, found through `trace.ci.run_url`. An ingested run of a deleted agent still lists, with agent `—`. A `failed` run (no `agent_runs` row) of a deleted agent drops out of the list. That is the default planned.
- [non-blocking] Files outside both specs' ownership lists, none on A's list: `server/src/platform/container.ts`, `server/package.json` + `server/pnpm-lock.yaml`, `client/src/components/ci-runs/**`. This is the second question.
- [non-blocking] Stage 7 needs A's GLOBAL nav group, so it runs only after A merges. AC-57 cannot be checked before then. This is the first question.
- [non-blocking] Wizard rule, a plan choice: `workflow_yaml` is sent only if the author edited the text. Otherwise the server regenerates the workflow from the Configure choices. Triggers changed after an edit are therefore not reflected in the edited text (AC-6 governs it).
- [non-blocking] The runner always uses `OpenRouterProvider` (`agent-runner/src/index.ts:40`). An agent whose model id is not an OpenRouter slug fails in CI. Demo with an OpenRouter agent.
- [non-blocking] The ~1.6 MB runner goes inline through `createTree` content. If GitHub refuses the size, the export answers 502 (EC-7) and the zip remains available.
- [non-blocking] The sync lock (AC-50) is in memory: it holds within one API process, which is the local-first setup.
- [→ researcher] R1: token scopes. Classic `repo` + `workflow`, or fine-grained Contents RW, Pull requests RW, Workflows RW, Actions R. Without `workflow` GitHub refuses the commit (Stage 3 step 15).
- [→ researcher] R2: a `pull_request` workflow run's `head_sha` equals the PR head SHA. Checked in Stage 4 step 3 with read-only `gh api`.
- [→ researcher] R3: full commit SHAs of `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` @v4. Resolved in Stage 3 step 2.

## 8. Handoff to reviewers
- Architecture:
  - New consumer ports in `server/src/modules/ci/types.ts`, satisfied structurally by `container.agentsRepo` / `skillsRepo`.
  - `CiRepository` writes tables owned by other features (`agent_runs`, `run_traces`), and `insertIngestedRun` opens its transaction inside the repository. Both follow the precedent of `AgentsRepository.deleteById` (`server/INSIGHTS.md`) and should be looked at against `rules/drizzle-persistence.md` § "Transactions are a use-case decision".
  - The jsonb join `run_traces.trace->'ci'->>'run_url' = ci_runs.github_url` replaces a link column (NFR-1).
  - The new container getter.
  - The one raw `fetch` (zip blob) lives in `client/src/lib/hooks/ci.ts`.
  - `GitHubClient` gains four methods and `CommitFilesPayload.prune`.
- Security:
  - Six new routes; `repo` regex (AC-25) before any outgoing GitHub URL.
  - `workflow_yaml` is committed verbatim (author-controlled, never executed by the studio).
  - The secret-value scan over generated files (AC-20).
  - The generated workflow: `pull_request` only, base checkout, `persist-credentials: false`, pinned SHAs, no PR text in `run:` (AC-26…AC-31).
  - Artifact ingest: 1 MB cap before and after download, Zod parse, SHA and repo-id checks, plain-text rendering, `github_url` only from GitHub (AC-41…AC-44, NFR-9).
  - Runner redaction of both tokens (AC-34).
  - fflate unzip with a single-entry filter.

## 9. Execution
Mode: multi-agent — stated in the task ("multi-agent, at most 3 implementer agents in total", tracks that do not edit the same files).
Recommended: multi-agent. After the shared contracts, the server and client tracks have disjoint write sets and each holds two non-trivial stages. The runner rides in the shared brief because the server and the bundle depend on it.
| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| shared | 1–2 | `server/src/vendor/shared/contracts/{eval-ci,trace}.ts`, `client/src/vendor/shared/contracts/{eval-ci,trace}.ts`, `agent-runner/src/**` | — | alone |
| server | 3–4 | `server/src/modules/ci/**`, `server/src/vendor/shared/adapters.ts`, `server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts`, `server/src/platform/container.ts`, `server/src/modules/index.ts`, `server/package.json`, `server/pnpm-lock.yaml` | shared | parallel |
| client | 5–6 | `client/src/lib/hooks/ci.ts`, `client/messages/en/ci.json`, `client/src/components/ci-runs/**`, `client/src/app/ci-runs/**`, `client/src/app/agents/[id]/_components/AgentEditor/**` | shared | parallel |
| join | 7 | `client/src/vendor/ui/nav.ts` (+ shared-file merge resolution) | server, client, A merged | alone, calling session (first question) |

Briefs, one fresh `implementer` each, three in total:
- shared · stages 1–2 → "Execute stages 1–2 of specs/2026-10-18-export-to-ci-plan.md (track shared). Write only inside: server/src/vendor/shared/contracts/{eval-ci,trace}.ts, client/src/vendor/shared/contracts/{eval-ci,trace}.ts, agent-runner/src/**. Write no new tests. Check with: .claude/agents/scripts/check-code.sh server; .claude/agents/scripts/check-code.sh client; cd agent-runner && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run && pnpm build."
- server · stages 3–4 → "Execute stages 3–4 of specs/2026-10-18-export-to-ci-plan.md (track server). Write only inside: server/src/modules/ci/**, server/src/vendor/shared/adapters.ts, server/src/adapters/github/octokit.ts, server/src/adapters/mocks.ts, server/src/platform/container.ts, server/src/modules/index.ts, server/package.json, server/pnpm-lock.yaml. Write no new tests. Check with: .claude/agents/scripts/check-code.sh server."
- client · stages 5–6 → "Execute stages 5–6 of specs/2026-10-18-export-to-ci-plan.md (track client). Write only inside: client/src/lib/hooks/ci.ts, client/messages/en/ci.json, client/src/components/ci-runs/**, client/src/app/ci-runs/**, client/src/app/agents/[id]/_components/AgentEditor/**. Write no new tests. Check with: .claude/agents/scripts/check-code.sh client."

After briefs 2 and 3: unfiltered `check-code.sh server` and `check-code.sh client` (section 0), then plan-verifier, then architecture-reviewer. The fix loop is capped at 2 iterations and at most 2 fix subagents in total. Stage 7 and the AC-70 checks follow once A has merged.
single-agent: the same briefs one after another, 1 → 3; the Runs column is not used.

## 10. Recommendations — not applied
none
