# Insights — repository

Cross-cutting learnings: the stack as a whole, tooling, and anything that spans
more than one package. Package-specific notes go in that package's `INSIGHTS.md`.

**Fixed sections — append to the matching one, never to the bottom of the file.**
If an entry fits nowhere here, it probably belongs in `docs/` or nowhere at all.

How to write one: 1–3 lines, newest first inside its section, recording what a
careful reader could not have predicted from the code. Not a task log, not a
changelog, not a restatement of the diff. When an entry has bitten a third time,
promote it to `CLAUDE.md` — § Conventions for a pattern, § Gotchas for a trap —
and leave it here as history.

## What Works

Approaches and solutions that held up, with the context that made them work.

- **To prove a screen made no model call, diff `agent_runs` / `run_traces`; the log alone is not enough.** (2026-09-19) Provider, prompt and token lines are only emitted from inside a run (`server/src/modules/reviews/run-executor.ts`), so a quiet log proves nothing on its own — while every real run inserts exactly one `agent_runs` row and exactly one `run_traces` document, which is a signal that cannot be missed.
  → Snapshot both counts, exercise the screen, snapshot again, and only then read the log tail; a static `grep` for provider imports in the feature's files is stronger still. Kept as a recipe on purpose — a one-off checker script in `scripts/` would rot next to `dev.sh` and `e2e.sh`.

## What Doesn't Work

Dead ends and anti-patterns: what was tried, why it failed, what to do instead.
**The highest-value section and the one most often left empty. Fill it.**

- **A `PreToolUse(Bash)` hook that matches a bare substring locks you out of fixing the hook itself.** `guard-pr.sh` first gated on `gh[[:space:]]+pr[[:space:]]+(create|ready)` anywhere in the command, so the very tool call carrying the patch was refused — its text contained `--check "gh pr create --fill"` as test data. The block is silent about this: it reads exactly like a real PR being stopped.
  → Match the binary in COMMAND POSITION only (`(^|[;&|(]|&&|\|\|)[[:space:]]*(VAR=x[[:space:]]+)*gh[[:space:]]+pr …`) and exit 0 early when the command invokes the guard script itself. Verify a gate with a table of allow/deny commands run through `--check`, never by typing the real command.

## Codebase Patterns

Conventions and architectural decisions found while working here, before they are
settled enough to move into `CLAUDE.md`.

- **A consumer-declared structural port is what actually breaks a module/composition-root cycle — moving code does not.** `repo-intel/service.ts → platform/container.ts → repo-intel/service.ts` survived every rearrangement; it disappeared the moment the module declared `RepoIntelDeps` in its own `types.ts` and stopped importing `Container` at all. `Container` satisfies the interface structurally, so `new RepoIntelService(this)` in the container is unchanged and there is no registration step. Same pattern in `modules/reviews/deps.ts`, `pulls/service.ts` (`PullsRepoReader`), `polling/service.ts` (`PollingPullWriter`), `workspace/service.ts` (`WorkspaceRepoReader`).
  → When a module needs another module's data or a container capability, write the two-or-three-method slice you actually call and let the concrete class satisfy it. Importing the real class back is what `no-cross-module-internals` catches — it fired on `reviews/deps.ts → agents/repository.ts` and the fix was an `AgentsReader` interface over `AgentRow`.

- **Corrected 2026-09-21: the layering baseline below is history — the tree is now green and the rules are enforced.** `pnpm exec depcruise src --config .dependency-cruiser.cjs` in `server/` reports `no dependency violations found` across 157 modules, with all ten rules at `severity: 'error'` and a CI step in `.github/workflows/server-unit.yml`. The four routes go through service+repository, no `modules/**` service takes `Container`, and the repo-intel import cycle is gone.
  → Treat the entry below as the before-picture, not as work outstanding. New backend code must keep `arch:check` green; the rules cannot be lowered to make a change fit.

- **The backend layering is service-locator + transport-reaches-persistence, measured not assumed.** (2026-09-21) Four route files query Drizzle straight from the HTTP layer (`modules/{polling,pulls,settings,workspace}/routes.ts` import `drizzle-orm` + `db/schema.js`); five collaborators take the whole DI container instead of named dependencies (`reviews/service.ts:33`, `agents/service.ts:54`, `repos/service.ts:36`, `repo-intel/service.ts:104`, `reviews/run-executor.ts:45`); and `ReviewService.resolveTargets()` returns `AgentRow[]` (`typeof agents.$inferSelect`). Adapters are the clean half — every external call already sits behind an interface in `vendor/shared/adapters.ts` — but repositories have no port.
  → Reproduce with two greps (`container: Container` under `modules/`, and `drizzle-orm|db/schema` in `*/routes.ts`) before claiming progress. Order matters: lift the four routes onto service+repository first — the ports the services need are only visible once routes stop bypassing them. Rules and migration phases are in `.claude/skills/onion-architecture/`.

- **Run cost is already plumbed end-to-end — only the sink was removed.** `reviewer-core/src/llm/openrouter.ts` asks OpenRouter for `usage: { include: true }` and returns the real `usage.cost` (falling back to the injected PriceBook), and `reviewer-core/src/review/run.ts:184` sums it per chunk, but `server/src/db/migrations/0009_complex_runaways.sql` DROPs `agent_runs.cost_usd` and `server/src/modules/reviews/run-executor.ts:213` destructures only tokens + grounding, discarding `outcome.costUsd`. Contracts that declare `cost_usd` (AgentColumn, AgentStats, eval/ci/knowledge) are aspirational, not proof it is persisted.
  → Surfacing cost means re-adding the column and forwarding `outcome.costUsd`; never build a second pricing path or a per-run estimation call.

## Tool & Library Notes

Quirks of dependencies, versions and tooling — what a library does that its docs
do not say.

- **`jq` `//` treats `false` as empty, so `.blocked // true` turns a PASSING verdict into a block.** `guard-pr.sh:67` read the gate decision that way; a verdict with `"blocked": false` and matching hashes still refused `gh pr create`, and the failure looks like a stale-artifact bug rather than a JSON read.
  → For any boolean read from JSON use `if has("k") then .k else <default> end`; keep `//` for strings. A gate test that only exercises the deny path will never catch it — assert the allow path too.

- **A dependency-cruiser rule targeting an npm package matches the RESOLVED path, not the specifier — so `^drizzle-orm` never fires and the rule passes vacuously.** Under pnpm the graph reports `node_modules/.pnpm/drizzle-orm@0.38.4_postgres@3.4.9/node_modules/drizzle-orm/index.cjs`, so the `^` anchor guarantees zero matches; the first `no-routes-to-drizzle` run reported 0 violations against four route files that plainly imported it.
  → Write `to: { dependencyTypes: ['npm'], path: 'node_modules/(drizzle-orm|postgres)' }` and prove a new rule fires before trusting a green run. The same trap applies to the `$1` backreference in `from.path` — it does substitute (a probe rule `to: '^src/modules/$1/'` reported 62 same-module edges), but a rule that is silently inert looks identical to a rule that is satisfied.

- **`dependency-cruiser@17` is already a `server/` runtime dependency, and the repo has no ESLint anywhere.** `server/src/adapters/depgraph/index.ts:17` imports `cruise` from it to build the repo-intel import graph, so architecture linting costs no new package; a `find` for `.eslintrc*` / `eslint.config.*` across all four packages returns nothing, so `eslint-plugin-boundaries` would mean introducing ESLint first.
  → Enforce layering with a `depcruise` config + script, not with an ESLint plugin. Two gotchas: this package is ESM and imports `./service.js` from `service.ts`, so `tsPreCompilationDeps: true` is required for resolution; and `server/package.json` is `skip-worktree`, so CI must call `pnpm exec depcruise` directly rather than a script name.

## Recurring Errors & Fixes

Error or symptom → cause → fix, one entry each, so the next occurrence is a lookup
instead of an investigation.

- **`psql -U postgres` into `devdigest-postgres` answers `role "postgres" does not exist`.**
  `docker-compose.yml` sets `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` all to `devdigest`,
  so the default role habit fails in a way that reads like a broken or half-initialised container.
  → `docker exec devdigest-postgres psql -U devdigest -d devdigest`, matching `DATABASE_URL` in `server/.env`.

- **`relation "repositories" does not exist` while every migration is applied — the table is `repos`.**
  `CLAUDE.md` § Gotchas reads that message as "migrations were not applied"; a guessed plural-noun
  table name fails identically. Real names: `repos`, `pull_requests`, `reviews`, `findings`.
  → Run `\dt` before writing an ad-hoc count query instead of inferring the name from the entity.

- **App looks empty after a restart ("nothing works"), but every endpoint answers 200.**
  Usually the data is gone, not the app: no repos, or the only repo has no imported PRs.
  → `GET /repos` plus `select count(*) from pull_requests`, and grep the API log for
  `DELETE /repos/` — a browser tab issuing the confirm-gated remove looks identical to
  a boot failure from the UI. Importing PRs needs a `GITHUB_TOKEN`, which is absent from
  `server/.env` by default.

## Session Notes

Dated summaries as `### YYYY-MM-DD — topic`: what was worked on and what state it
was left in. Prune an entry once its content has moved into a section above.

### 2026-09-21 — skills feature (storage → editor → agent binding → prompt)
Spec first (`specs/skills.md` + the two package halves), then built: `server/src/modules/skills/`
(CRUD, `skill_versions` + restore, a dependency-free ZIP reader for imports, a bundled community
catalog), migration `0011` adding `skill_versions.note`, a `SkillsReader` port in `reviews/deps.ts`
so `run-executor` renders one labelled block per linked+enabled skill, `/skills` in the client
(list · config · preview · stats · versions + import drawer), an agent-editor Skills tab with
ordering, and a seeded `Test Quality Reviewer` with 3 linked skills. Evals tab and the design's
pull-frequency/accept-rate metrics were deliberately NOT built — no data backs them. Green:
typecheck in client/server/reviewer-core, `arch:check` (167 modules), `next build`. Tests were
WRITTEN but not run (standing rule); migrations 0011/0012 are generated, not applied to the local DB.
Then `/pr-self-review` over 11 lanes found 2 CRITICALs — the agent's Skills tab could unlink every
skill when clicked before its links loaded, and `PUT /skills/:id {}` answered 500 (`No values to set`)
— both fixed, along with transactions around the version snapshots, real-length ZIP bounds, a
route-level `bodyLimit`, and an index on `agent_skills(skill_id)` (migration 0012). Closed with
`Agent.skill_count`, `specs/homework-2-acceptance.md`, `PR_BODY-skills.md` and `DEMO_SCRIPT-skills.md`.

### 2026-09-21 — pr-self-review skill + PR gate
Plan first (`specs/pr-self-review-skill.md`), then built `.claude/skills/pr-self-review/` — SKILL.md,
`rules/{routing,severity,repo-conventions}.md`, `examples.md`, `tile.json` and five scripts
(`collect-diff`, `route-skills`, `write-verdict`, `guard-pr`, `lib`). `.claude/settings.json` is NEW in this
repo and exists only to register the `PreToolUse(Bash)` hook. Gate verified with a 13-case allow/deny matrix;
the local artifact under `.claude/pr-self-review/` (git-ignored) was deleted afterwards, so the gate is closed
until the first real run. No package code touched, no commits.

### 2026-09-21 — onion-architecture skill
Researched the backend stack and the layering baseline, wrote the plan to `specs/onion-architecture-skill.md`,
then built `.claude/skills/onion-architecture/` (SKILL.md + 8 rules + examples.md + references.md + tile.json)
and added its row to `.claude/skills/README.md`. Phase 0 only — no `server/` or `reviewer-core/` code touched,
and `.dependency-cruiser.cjs` exists as a paste-ready block inside `rules/enforcement.md`, not on disk.
A parallel session was adding `frontend-ui-architecture` at the same time; both catalog rows coexist.

### 2026-09-17 — findings grouped by severity on four surfaces
Spec first (`specs/findings-by-severity.md` plus the per-package halves), then built:
`GET /repos/:id/pulls` now returns a `findings` summary for each PR's LATEST review (one extra
IN-query + `src/modules/pulls/findings-summary.ts`), the PR list has a FINDINGS column with a
read-only hover popover, timeline tiles show the same counts, and a review-run card's pills
filter its own findings. Counting is a group-by — no model call anywhere. Green: client 52 tests,
server 106 hermetic + the two PR-list DB suites (9), typechecks in client/server/reviewer-core.
Two lab-1 cost assertions in `RunHistory.test.tsx` were red before this session and were fixed.
No commits — branch `feature/lab1`, and the uncommitted lab-1 cost changes are still in the tree.

### 2026-09-16 — run cost surfaced on three screens
Spec and plan written to `specs/run-cost.md` / `specs/run-cost-plan.md`, then implemented:
`agent_runs.cost_usd` restored by migration `0010` (generated and applied locally),
`run-executor` forwards the engine's `costUsd` into the row and the trace, and the PR list,
run timeline and trace drawer render it. Typechecks green in server, client and reviewer-core;
tests were WRITTEN but not run (standing rule). No commits. Stack was down and was restarted
with `./scripts/dev.sh --no-seed` — DB still holds 1 repo and 0 pull requests, so the new COST
column has no data to show locally.

### 2026-09-16 — second "app is down" report the same day
This time the processes really were down: nothing listening on :3000/:3001 while
`devdigest-postgres` had been healthy for hours. `./scripts/dev.sh --no-seed` restored both
(API :3001, web :3000; migrations are idempotent and only logged `__drizzle_migrations already exists`).
DB state is unchanged from the earlier restart — 1 repo (`vklyovsa/dev-digest`), 0 pull_requests — so
the UI still renders empty. Nothing was seeded.

### 2026-09-16 — stack brought up after an "app stopped working" report
Stack was healthy the whole time (Postgres, migrations, API :3001, web :3000). The
symptom was an empty database: the seeded `acme/payments-api` had been removed by a
`DELETE /repos/:id` from a browser session, and the remaining repo has no imported PRs.
Nothing was reseeded — see the standing rule not to seed unless asked.

## Open Questions

Unresolved behaviour, undecided design, unverified assumptions. Delete an entry when
it is answered — the answer belongs in another section.

- **Unresolved: `INFO` is a fourth severity that only the client design system knows about.** (2026-09-17) The contract enum carries three values (`server/src/vendor/shared/contracts/findings.ts:11`), while `client/src/vendor/ui/primitives/tokens.ts:13` declares `INFO` and two client constant maps keep an entry for it; nothing in the engine, the API or the DB can produce one, so those branches are unreachable today.
  → Decide whether to promote it (contract + the four engine tables listed in `reviewer-core/docs/severity.md`) or delete it; `reviewer-core/specs/severity-source-of-truth.md` carries the spec either way.
