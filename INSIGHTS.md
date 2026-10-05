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

- **Corrected 2026-09-24: the seed re-link was found by comparing the live `agent_skills` rows with `SEED_SKILLS` BEFORE any run, not by the dry run.** The dry run on the copy then proved the fixed seed only added rows. Both steps matter: the comparison finds what an operation would undo, the copy proves what it actually does.
  → Before a seed or migration on the dev DB, list what the user has changed away from the defaults (unlinked skills, deleted agents, edited settings), then dry-run on the copy.

- **Any write to the dev DB goes through a dry run on a restored copy in the SAME container first, then a per-table row diff.** (2026-09-24) `pg_dump -Fc` the `devdigest` DB, `createdb devdigest_seedcheck` + `pg_restore --no-owner` inside `devdigest-postgres`, run the operation with `DATABASE_URL` pointed at the copy, diff sorted `psql -At` exports of every table it could touch with `comm -23` (lines removed or changed must be zero), `dropdb`, then repeat on the real DB and diff again. It caught what reading the seed did not: re-seeding re-linked `mock-overuse-gate` into Test Quality Reviewer after the user had unlinked it.
  → Keep the pre-change dump until the user has looked; the whole cycle takes seconds and the copy needs no second container.

- **To prove a screen made no model call, diff `agent_runs` / `run_traces`; the log alone is not enough.** (2026-09-19) Provider, prompt and token lines are only emitted from inside a run (`server/src/modules/reviews/run-executor.ts`), so a quiet log proves nothing on its own — while every real run inserts exactly one `agent_runs` row and exactly one `run_traces` document, which is a signal that cannot be missed.
  → Snapshot both counts, exercise the screen, snapshot again, and only then read the log tail; a static `grep` for provider imports in the feature's files is stronger still. Kept as a recipe on purpose — a one-off checker script in `scripts/` would rot next to `dev.sh` and `e2e.sh`.

## What Doesn't Work

Dead ends and anti-patterns: what was tried, why it failed, what to do instead.
**The highest-value section and the one most often left empty. Fill it.**

- **A plan's absence check on generic words can never print nothing: `grep -rn "chunks\|Re-index" client/src` matches code that existed before the feature.** (2026-10-04) `specs/2026-10-04-project-context-plan.md` §6 used `useReindexContext\|devdigest/specs\|chunks\|Re-index` over all of `client/src` as its "old model is gone" proof; `AddRepoView.tsx`, `Showcase.tsx`, `BlastRadiusCard.test.tsx` and `chunks_indexed` in `vendor/shared/contracts/platform.ts` match it, so three implementers and plan-verifier each had to narrow it and declare a deviation.
  → Build an absence check from identifiers only the removed code had (`useReindexContext`), or scope the generic words to the feature's own files and catalog; run the grep once on the base commit before it goes into a plan's Done-when.

- **Corrected 2026-10-04: the clone under `server/clones/` IS refreshed — but only by `POST /repos/:id/resync`, and that route never reports a failure.** `GitClient.sync` (`server/src/adapters/git/simple-git.ts:102-111`) is the one place that runs `reset --hard origin/<branch>`; `clone()` on an existing checkout only fetches (`:74-78`), so the PR-list refresh leaves the working tree where it was. The route answers 202 even when the enqueue throws (`server/src/modules/repo-intel/routes.ts:43-64`), and there is no job-status route.
  → Anything that reads files from the clone (Project Context, repo-intel) shows the commit of the last resync: trigger one first (the Project Context page refresh, the Blast Radius degraded notice). A client waits by polling `GET /repos/:id/index-state` for a changed `lastIndexedSha` / `updatedAt` and treats silence as a timeout (`useBlastResync`, `useContextRefresh`); a failed resync looks exactly like a slow one.

- **An implementer's token bill is turns × standing context, not test output: over 16 implementer transcripts test runs were 9% of all context re-reads and 77 KB of output, while one-per-turn `cat` / `sed` / `grep` Bash calls were 47%.** (2026-10-04) Measured from the subagent transcripts Claude Code keeps per session (`subagents/agent-*.jsonl`, `message.usage` of each assistant turn, grouped by the tool that turn called): the context starts near 32K tokens, passes 100K by turn 5 (the whole plan at 40–79 KB, root `INSIGHTS.md` at 31–35 KB, 4–8 skill bodies of 13–19 KB each) and ends at 230–440K; the single 312-turn Intent Layer run re-read 82.6M tokens, the three ~50-turn Blast Radius track runs 28M together.
  → To cut the cost, shorten the run (a fresh implementer per one or two stages), batch a stage's reads into one message, and hand the agent its slice of the plan; a quieter test reporter changes nothing — `--reporter=dot` prints the same 39 lines off a TTY on vitest 2.1.9.

- **Proving absence with `git grep` passes vacuously for a new, still-untracked module: `git grep` searches tracked files only.** (2026-09-27) plan-verifier "proved" `readFile(`, Jira fetches and `routeModel` absent from `server/src/modules/intent/` with `git grep` → empty, while the whole folder was untracked; the same command missed `FETCH_CROSS_REPO_ISSUES`, declared at `server/src/modules/intent/constants.ts:30`.
  → Before a feature is committed, prove presence/absence with `grep -rn` (or `git grep --untracked`), never plain `git grep`; re-run any absence claim that used it.

- **pr-self-review runs no drizzle/postgres lane on a table edit: routing matches only `server/src/db/{schema,rows}.ts`, but the tables live in `server/src/db/schema/*.ts`.** (2026-09-27) `.claude/skills/pr-self-review/rules/routing.md:21` and its twin `scripts/route-skills.sh:94` (`^server/src/db/(schema|rows)\.ts$`); `schema.ts` is only the barrel, so editing e.g. `schema/reviews.ts` routes to no DB skill — only a generated migration under `migrations/` triggers the lane.
  → Apply `drizzle-orm-patterns` / `postgresql-table-design` to schema edits deliberately, or widen both matchers to `server/src/db/schema/` together.

- **Regex quote-stripping in an allowlist guard hides commands: in `echo "it's" ; rm x ; echo 'y'` the apostrophe pairs with the later quote.** (2026-09-27) The first `readonly-guard.sh` replaced `'[^']*'` with a placeholder, so the `rm` became quoted data and passed the allowlist; it also broke on `\"` inside double quotes.
  → Use the character scanner `lib_strip_quotes` in `.claude/agents/scripts/guard-lib.sh` (awk, tracks quote state, keeps double-quoted `$(` visible); add a mixed-quote row to `guard-cases.tsv` for any new guard.

- **A guard hook that exits 1 ALLOWS the tool call, and `block` inside `$(...)` only exits the subshell.** (2026-09-27) With neither `jq` nor `node` on PATH, `tool="$(lib_payload_field tool_name)"` blocked in a subshell, the parent saw an empty tool and exited 0 — every Bash/Edit call passed. Claude Code treats hook exit 1 as a non-blocking error.
  → Check capabilities in the main shell, write `x="$(…)" || exit 2`, and trap EXIT to turn any code other than 0/2 into 2 (`.claude/agents/scripts/*-guard.sh`). Test hook mode with a PATH lacking the tool, not only `--check`.

- **Corrected 2026-09-24: `guard-pr.sh` still refuses a command that only CONTAINS the PR-create text on its own line, e.g. inside a heredoc.** `GATE_RE` anchors on `^`, and `grep -Eq` is line-based, so every line of a multi-line command is "command position": a Python heredoc that edited `DEMO_SCRIPT-hw2.md` was blocked because one replacement line started with the gh command. Nothing ran, and the refusal reads exactly like a real PR being stopped.
  → Put such text in a file written with the Write tool and run `python3 /tmp/x.py` (the Bash command then carries no match), or split the literal in code. Do not reach for `PR_SELF_REVIEW_OVERRIDE`: that is reserved for an explicit user instruction.

- **A demo patch cut inside `server/clones/<owner>/<repo>` targets a stale base: DevDigest never refreshes that checkout, so the patch fails on the fork's real `main`.** (2026-09-23) `specs/fixtures/api-contract-reviewer/breaking-pull-list.patch` was made against `c6af1e4` (the clone's HEAD, also claimed as "current main" in `DEMO_SCRIPT-hw2.md:53`), while `git ls-remote origin main` is `faa0552`, whose `server/src/modules/pulls/routes.ts` imports `isNull` — `git apply --check` fails on the first hunk in a fresh clone and in the working tree, yet passes inside the clone.
  → Cut demo/fixture patches from a fresh clone of `origin/main` and prove them with `git apply --check` there; never treat `server/clones/**` as the current state of a repo.

- **A `PreToolUse(Bash)` hook that matches a bare substring locks you out of fixing the hook itself.** `guard-pr.sh` first gated on `gh[[:space:]]+pr[[:space:]]+(create|ready)` anywhere in the command, so the very tool call carrying the patch was refused — its text contained `--check "gh pr create --fill"` as test data. The block is silent about this: it reads exactly like a real PR being stopped.
  → Match the binary in COMMAND POSITION only (`(^|[;&|(]|&&|\|\|)[[:space:]]*(VAR=x[[:space:]]+)*gh[[:space:]]+pr …`) and exit 0 early when the command invokes the guard script itself. Verify a gate with a table of allow/deny commands run through `--check`, never by typing the real command.

## Codebase Patterns

Conventions and architectural decisions found while working here, before they are
settled enough to move into `CLAUDE.md`.

- **Settings → Models is OpenRouter-only and has no reset: it lists `useProviderModels("openrouter")` and saves every pick as `provider: "openrouter"`.** (2026-09-27) `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsModels/SettingsModels.tsx:24,32`; an OpenAI/Anthropic `FEATURE_MODELS` default (e.g. `review_intent` = `openai/gpt-4.1`) is shown only while unset and cannot be picked again after the first change.
  → Give a feature an OpenRouter default that is already priced in `server/src/adapters/llm/pricing.ts` (e.g. `deepseek/deepseek-v4-flash`), in all three registry copies.

- **The starter pre-wires a course lesson on both sides before the lesson exists — search for the noun across the whole package before adding anything named after it.** (2026-09-22) For L02 "conventions" there is no `server/src/modules/conventions/` and no `client/src/app/**/conventions` route, yet `client/messages/en/conventions.json` is a full namespace (empty state, "Re-scan", "Run extraction"), `client/src/components/app-shell/helpers.ts` already maps `/conventions` in `activeKeyFor`, `FEATURE_MODELS` carries a `conventions` row in both registry copies (rendered by Settings → Models), `ConventionCandidate` sits in `contracts/knowledge.ts`, `PluginConvention` in `contracts/productionize.ts`, and `server/src/adapters/mocks.ts:49` names the structured schema `ConventionExtraction` the mock expects. A grep under `modules/` or `app/` finds only the repo-intel facade method and a settings comment, so the stubs look absent.
  → Before creating a lesson module, grep `messages/`, `vendor/shared/contracts/`, `lib/feature-models.ts`, `app-shell/helpers.ts`, `vendor/ui/nav.ts` and `adapters/mocks.ts` for the lesson noun and extend those files; a second namespace, contract or feature-model row is the likely duplicate.

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

- **The `subagent_tokens` an `Agent` result or a task notification reports is the agent's context at its LAST API call, not what the run cost — for a long run the spend is 20–30× that figure.** (2026-10-04, Claude Code 2.1.284) Checked against the per-session transcripts for all 15 agents of the Project Context run: the figure equals input + cache write + cache read + output of the final call (spec-creator: 477,514 reported, 15.6M cache-read tokens summed over its 53 calls; the run: 67.3M cache read across 410 subagent calls). In a transcript one API response is several lines sharing `message.id`, with `usage` growing while it streams, so summing lines over-counts — take the maximum per id.
  → Never add `subagent_tokens` up as a cost; measure a run with `node .claude/skills/workflow-retro/scripts/collect-run.mjs` (totals, per-agent sums, the `cost-state` snapshot).

- **An edit to an existing `.claude/agents/<name>.md` is NOT picked up by the running session — only a new file is — so a subagent keeps running the prompt it was registered with.** (2026-10-04, Claude Code 2.1.289) `spec-creator.md` was rewritten after the session announced it; four runs still answered in an earlier version's wording (`sends the answers back; the draft is written once every one is answered`) and refused `check-spec.sh` as "outside my read-only command list", which only the old Bash list lacks. Files the agent reads at run time (`specs/TEMPLATE.md`) were current, so the run looks half-updated.
  → Smoke-test an agent prompt in a fresh session after its last edit; inside the editing session, treat a run as a test of the registered version and say so.

- **A `${VAR}` inside a `claude mcp add -H` header is stored literally and expanded from the environment at launch — at `--scope local` too, not only in `.mcp.json` — so a token never has to be written into `~/.claude.json`.** (2026-10-03) Proved with a throwaway listener on `127.0.0.1`: registered with `-H 'Authorization: Bearer ${ENVPROBE_TOKEN}'`, it received `Bearer expanded-ok`. It matters for the remote GitHub MCP (`https://api.githubcopilot.com/mcp/`): its auth-server metadata at `https://github.com/.well-known/oauth-authorization-server/login/oauth` carries no `registration_endpoint`, so `/mcp` has no client to authenticate with and a PAT header is the way in; with the variable unset `claude mcp get github` reports `HTTP 400 … Authorization header is badly formatted`.
  → Register with a single-quoted `${GITHUB_PERSONAL_ACCESS_TOKEN}` header and export the variable in the shell that launches `claude`; read that 400 as "variable not exported" before suspecting the token.

- **MCP TypeScript SDK v2 cannot run on the Zod this repo pins: `@modelcontextprotocol/server@2.3.0` depends on `zod ^4.2.0` (Node >=20), while `server/`, `client/` and `reviewer-core/` declare `zod ^3.24.1` (3.25.76 installed).** (2026-10-03) Checked with `npm view @modelcontextprotocol/server version dependencies.zod`; the v1 line `@modelcontextprotocol/sdk@1.32.0` still accepts `zod ^3.25 || ^4.0`. The v2 upgrade guide adds that Zod 3 schemas, the `zod/v4` subpath of 3.25.x included, fail to type-check in `registerTool` (TS2769). No MCP SDK is in any lockfile yet.
  → For `devdigest-mcp` choose deliberately: SDK 1.x on Zod 3.25, or SDK 2.x with its own `zod ^4.2` in a separate package; either way do not pass the `vendor/shared` Zod 3 contracts into a v2 tool schema.

- **pnpm 12.4.2 exits non-zero with `ERR_PNPM_IGNORED_BUILDS` (esbuild, sharp) AFTER doing the work — on `pnpm add`, and on `pnpm <script>` in `client/` too.** (2026-09-28) `pnpm add pretty-ms` in a fresh fork clone printed the error yet wrote `package.json` and `pnpm-lock.yaml`; `pnpm typecheck` / `pnpm build` in `client/` failed the same way before running anything, while `./node_modules/.bin/tsc --noEmit` was green. `--config.strict-dep-builds=false` did not help, and pnpm also drops an `allowBuilds:` stub into `client/pnpm-workspace.yaml`.
  → Judge `pnpm add` by the lockfile (`grep <pkg> pnpm-lock.yaml`), run checks via `node_modules/.bin/<tool>`, and revert the `pnpm-workspace.yaml` stub; do not answer the `approve-builds` prompt on the user's behalf.

- **`permissionMode` in an agent is not a guard: a session in `bypassPermissions` forces its subagents into it.** (2026-09-27, https://code.claude.com/docs/en/sub-agents) Path-scoped writes are not a frontmatter field either (anthropics/claude-code#31940, closed not planned). A new `.claude/agents/<name>.md` is picked up by the running session (Claude Code 2.1.280) — no restart needed.
  → Enforce read-only / write scopes with `tools`/`disallowedTools` plus a frontmatter `PreToolUse` hook (`.claude/agents/scripts/`), and state the same rules in the agent text for sessions before workspace trust.

- **A project subagent cannot ask the user anything: `AskUserQuestion` is stripped from every subagent, whatever `tools:` lists.** (2026-09-27) The first `researcher.md` listed it and relied on it for clarifying questions; it was dead weight. Also from the same docs page: `skills:` in agent frontmatter only preloads — the Skill tool still reaches every project skill unless `Skill` is removed — and frontmatter hooks of a `.claude/agents/` agent run only after the workspace-trust dialog is accepted (https://code.claude.com/docs/en/sub-agents).
  → Agents return a `Clarification needed` / `Blocked` block and the calling session asks; to forbid skills, deny `Skill`, never rely on an empty `skills:` list.

- **`jq` `//` treats `false` as empty, so `.blocked // true` turns a PASSING verdict into a block.** `guard-pr.sh:67` read the gate decision that way; a verdict with `"blocked": false` and matching hashes still refused `gh pr create`, and the failure looks like a stale-artifact bug rather than a JSON read.
  → For any boolean read from JSON use `if has("k") then .k else <default> end`; keep `//` for strings. A gate test that only exercises the deny path will never catch it — assert the allow path too.

- **A dependency-cruiser rule targeting an npm package matches the RESOLVED path, not the specifier — so `^drizzle-orm` never fires and the rule passes vacuously.** Under pnpm the graph reports `node_modules/.pnpm/drizzle-orm@0.38.4_postgres@3.4.9/node_modules/drizzle-orm/index.cjs`, so the `^` anchor guarantees zero matches; the first `no-routes-to-drizzle` run reported 0 violations against four route files that plainly imported it.
  → Write `to: { dependencyTypes: ['npm'], path: 'node_modules/(drizzle-orm|postgres)' }` and prove a new rule fires before trusting a green run. The same trap applies to the `$1` backreference in `from.path` — it does substitute (a probe rule `to: '^src/modules/$1/'` reported 62 same-module edges), but a rule that is silently inert looks identical to a rule that is satisfied.

- **`dependency-cruiser@17` is already a `server/` runtime dependency, and the repo has no ESLint anywhere.** `server/src/adapters/depgraph/index.ts:17` imports `cruise` from it to build the repo-intel import graph, so architecture linting costs no new package; a `find` for `.eslintrc*` / `eslint.config.*` across all four packages returns nothing, so `eslint-plugin-boundaries` would mean introducing ESLint first.
  → Enforce layering with a `depcruise` config + script, not with an ESLint plugin. Two gotchas: this package is ESM and imports `./service.js` from `service.ts`, so `tsPreCompilationDeps: true` is required for resolution; and `server/package.json` is `skip-worktree`, so CI must call `pnpm exec depcruise` directly rather than a script name.

## Recurring Errors & Fixes

Error or symptom → cause → fix, one entry each, so the next occurrence is a lookup
instead of an investigation.

- **Running `pnpm` inside the npm package `mcp/` installs instead of running the command: it leaves `mcp/pnpm-lock.yaml`, `mcp/pnpm-workspace.yaml` and a re-linked `mcp/node_modules`.** (2026-10-03) `cd mcp && pnpm exec depcruise src --config .dependency-cruiser.cjs` never reached depcruise: pnpm 12 installed first, exited 1 with `ERR_PNPM_IGNORED_BUILDS`, and turned the seven direct dependencies into symlinks into a new `.pnpm/` store. It came from `architecture-reviewer`, whose check table has a depcruise row for `server/` only (`.claude/agents/architecture-reviewer.md:98`): briefed to cover `mcp/` as well, it reused the server form. The two untracked files then enter `collect-diff.sh` as a lockfile change in an npm package.
  → In `mcp/` run `npm run arch:check` / `npm run typecheck` / `npm test`, never `pnpm`; when briefing an agent to check `mcp/`, name those commands. To undo: `rm mcp/pnpm-lock.yaml mcp/pnpm-workspace.yaml && (cd mcp && npm ci)` — `package-lock.json` stays unchanged and the 305 tests pass again.

- **`route-skills.sh` aborts with `line 134: LANE: unbound variable` (exit 1) when no changed file adds a skill lane — i.e. on a docs-only or config-only diff.**
  (2026-10-03) `declare -A LANE` (`.claude/skills/pr-self-review/scripts/route-skills.sh:56`) never assigns, and under `set -u` bash 5.2.21 treats `${#LANE[@]}` on a never-assigned associative array as unbound (`bash -c 'set -u; declare -A L; echo ${#L[@]}'` → exit 1; `declare -A L=()` → 0). Mixing in one path that does route (e.g. `mcp/src/server.ts`) makes the same script exit 0, which is how the failure hides in mixed diffs.
  → Initialise it as `declare -A LANE=()` (one-line fix, not yet applied). Until then, read a crash on a docs-only file list as "no skill lane matched", not as a routing bug in the files, and route a docs-only change with a sentinel path to see the lanes.

- **API (and web) "drop after 5–20 minutes idle" when an agent session started the stack — it is killed, not crashed.** (2026-09-23)
  `./scripts/dev.sh` run as a Claude Code background Bash task belongs to that session; when the session ends (closed, or unloaded while idle) the whole dev.sh tree dies. Evidence: a session started it at 21:41 and its transcript got `<status>killed</status>` for the task at 21:50 with no user activity between. Ruled out: no OOM in kernel or systemd-oomd logs, no idle timers in the API, postgres.js survives idle disconnects, `tsx watch` SIGKILLs a stuck old process after 5s.
  → Start the stack from your own terminal/tmux, or detach it: `setsid nohup ./scripts/dev.sh --no-seed > <log> 2>&1 &`. Before debugging a "dropped" API, check whether `dev.sh` is still alive (`ps -eo pid,etime,cmd | grep dev.sh`).

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

### 2026-10-04 — spec-creator put under a guard
Corrects the two notes above: `spec-creator` now declares `write-scope-guard.sh --profile specs` (the user reversed the prompt-only decision). Edit/Write pass only for `<YYYY-MM-DD>-<feature-slug>.md` in the five spec folders — a new file, or one whose header says `Status: draft` — and for that folder's `README.md`; Bash goes to `readonly-guard.sh --bash-only`, the allowlist. `check-guards.sh` 194/194; the header rule reads the file at call time, so it was tested by hand on a temp root, not in `guard-cases.tsv`.
Not yet exercised as a live hook: this session still runs the agent definition it registered earlier (§ Tool & Library Notes), so the first run in a fresh session is the real test. Nothing committed.

### 2026-10-04 — spec-creator: checker, research route, first runs
`.claude/agents/scripts/check-spec.sh` (node: formats, EARS form, references, coverage, traceability; `--for-approval`, `--next-id`) is the agent's final self-check, runs on `implementation-planner`'s input (readonly-guard allowlist, `guard-cases.tsv` 159/159) and gates `Status: approved`. `specs/TEMPLATE.md` gained Traceability, a `verify:` ring with a hint, a Language rule and the `research` kind; the agent returns `Research needed` (one `researcher` per item, results back to the same instance via `SendMessage`), records a blocking question in the draft during a revision round, and reads `INSIGHTS.md` only for the packages a feature touches.
Four runs (bare noun, out-of-scope request, contradictory sources, a full draft from a Ukrainian description carrying an injected instruction) behaved as designed and the draft passed `check-spec.sh` — but they ran an EARLIER version of the prompt (§ Tool & Library Notes), so the current one is untested. The smoke draft was removed from `client/specs/`; nothing is committed.

### 2026-10-04 — spec-creator agent and the spec template
Added `.claude/agents/spec-creator.md` and `specs/TEMPLATE.md` (header `Spec ID` / `Status` / `Supersedes`, eleven sections, EARS criteria). The agent returns its blocking questions before it writes anything, then a `Status: draft` spec with the non-blocking questions and design proposals; the calling session sets `approved` after the user says so. One file per feature: `specs/` for two or more packages, `<package>/specs/` for one (`mcp/specs/` is new, `e2e/specs/` is excluded).
`implementation-planner` now answers `Blocked — the spec is not approved` for a template spec that is `draft` or holds a `[blocking]` question; `plan-verifier` and `test-writer` read the new IDs. `check-agents.sh` 10/10, `check-guards.sh` 157/157. The agent has no guard hook (prompt-only write scope, the user's decision) and has not been run yet; existing specs are not migrated, nothing is committed.

### 2026-10-04 — planner replaced by implementation-planner
`.claude/agents/planner.md` is gone; `implementation-planner.md` copies requirements from their source instead of authoring them, returns `Questions for the user` (unclear requirements, multi-agent or single-agent) for the calling session to relay, lists recommendations in plan §10 without applying them, lays out tracks in §9 and now runs under `readonly-guard.sh`.
Plan layout is §0–10; `README.md`, `brainstorm`, `implementer` and `plan-verifier` follow it. `check-agents.sh` 9/9, `check-guards.sh` 157/157. The agent has not been run since the change, and nothing is committed. Older plans, PR bodies and notes still say `planner` / "Development Plan" — history, left as is.

### 2026-10-04 — Blast Radius on the PR Overview tab and as an MCP tool (L04 homework)
Spec, plan, criteria and decisions are `specs/blast-radius{,-plan,-acceptance,-questions}.md`. Pipeline: planner → three implementers in parallel (server, client, mcp) → plan-verifier ∥ architecture-reviewer ∥ security-reviewer → two implementers for the follow-ups (plan Stage 10). Built: `server/src/modules/blast/` (`GET /pulls/:id/blast`, `/blast/history`), three `repo-intel` facade corrections (per-symbol caller cap, `factsByFile` on the fallback, `flag_off`), `GitHubClient.listMergedPullsWithFiles` over GraphQL, `BlastRadiusCard` on Overview (tree, graph, prior PRs, degraded state with Re-index), and `get_blast_radius` in `mcp/` instead of the stub.
Green: server unit 311 and `blast.it.test` 4, client 211, mcp 305, depcruise in `server/` and `mcp/`; reviewers found no CRITICAL or WARNING. Checked live against the dev DB, reads only (route, MCP over stdio, UI screenshots); the PR-list sync refreshed `pull_requests`, the index and `agent_runs` are untouched, and Re-index was never clicked. Nothing committed. Left to the user: the demo PR (`specs/fixtures/blast-radius-demo/make-demo-branch.sh`), the feature PR and the video (`DEMO_SCRIPT-blast-radius.md`, `PR_BODY-l04-blast-radius.md`).

### 2026-10-03 — devdigest-mcp: local stdio MCP server (L04)
Research, plan (`specs/devdigest-mcp-plan.md`, Appendix A is the tool contract) and Stages 1–7: new package `mcp/` (`@devdigest/mcp`, npm, SDK 1.32.0 + Zod 3.25.76) with `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions` and the `get_blast_radius` stub over the existing HTTP API; own depcruise config, `.github/workflows/mcp.yml`, pr-self-review routing for `mcp/src/**`. No change in `server/`, `client/`, `reviewer-core/`, `e2e/`.
Green in `mcp/`: typecheck, 275 tests in 15 files, `arch:check`; `tools/list` is 4,793 of 5,000 chars. Nothing committed. Left to the user: Stage 8 (Inspector, `/mcp`, `/context` token audit, the two lesson scenarios) — the server has not yet been run against the live API or from Claude Code. Open: `route-skills.sh` still crashes on a docs-only diff (§ Recurring Errors).

### 2026-09-27 — six project subagents + guards
Added `brainstorm`, `test-writer`, `plan-verifier`, `architecture-reviewer`, `security-reviewer` (renamed from `appsec-reviewer` by the user) and `doc-writer` per `specs/project-subagents-plan.md`; the guards share `guard-lib.sh`, `check-guards.sh` 157/157, `check-agents.sh` 9/9. Project policy now: tests may be run without asking (`AGENTS.md`); agents must not depend on personal `~/.claude` settings. plan-verifier (run twice) found nothing missing; `awk` is left off the read-only allowlist on purpose. Nothing committed.

### 2026-09-24 — full HW2 criteria audit against code
Checked all 53 criteria in code, not in the matrix. Closed five gaps: instruction files moved to `AGENTS.md` with `CLAUDE.md` as a one-line `@AGENTS.md` import (root, server, client, reviewer-core, e2e; Claude Code resolves it); the frontend skill now states pages/components/naming/tests in SKILL.md itself; the onion skill now forbids a route calling an adapter (checklist + grep in `rules/enforcement.md`, tree already clean); pr-self-review declares itself a Workflow dispatcher; the agent Skills tab uses a labelled toggle instead of a checkbox. Client 161 tests, build, arch check green. Left to the demo: 16 (an imported skill linked to a new agent), 17, 18 (A/B runs); the API Contract Reviewer appears only after `pnpm db:seed --no-demo`.

### 2026-09-24 — three gaps from the HW2 review closed
Model rationale is now stored (`conventions.rationale`, migration `0014`, NOT applied to the dev DB — `dev.sh` applies it on next start), shown as a "Why:" line on the card and carried into the skill body. `ConfirmDialog` shows why a delete failed, focuses Cancel, traps Tab and returns focus to its opener. `/skills` became a layout (`SkillsShell` with the list) plus pages, so a card click lands on `/skills/:id` with the list still beside it; old `?skill=` links are forwarded. Suites green: server unit 199, integration 81, client 160; dev DB and secrets verified unchanged.

### 2026-09-23 — conventions scan tuned on a real repo; API Contract Reviewer seeded
Measured the first real scan of `vklyovsa/dev-digest` (20 files, 13.2k tokens in, 9.1k out, 68s, $0.0042, 5 of 10 proposals kept) and acted on it: stratified sampling and whole-index `getConventionFacts` in repo-intel, a 36-file pool with a 20-line floor, `SAMPLE_TOKEN_BUDGET` 40k → 24k, a verifier that rebuilds bad ranges around real quotes and strips copied line gutters, category definitions in the prompt, and stale `running` scans reaped after 10 minutes. The API Contract Reviewer and its four skills are now in the seed (seed NOT run on the dev DB); re-seeding appends after an agent's existing links.
All suites run and green (server unit 197, integration 80, client 144); tests caught a presentational-card regression and an all-rejected empty state, both fixed. Dev DB row counts and `~/.devdigest/secrets.json` hash were snapshotted before and verified identical after. Decisions and two open findings (OpenRouter timeout retries, smoke test on the real DB) are in `specs/hw2-open-questions.md`.

### 2026-09-22 — homework 2 implemented: Conventions Extractor + the lab gaps
Built from `specs/conventions-extractor.md`: `server/src/modules/conventions/` (sampler → one structured model call → code-side evidence verification → rows), migration `0013` (conventions.accepted → status/category/lines/sha/scan_id/skill_id, new `convention_scans` with a partial unique index on one running scan per repo), `src/prompts/conventions.system.md`, the contracts in BOTH vendor copies, and the client screen `/repos/[repoId]/conventions` plus `/skills/[id]`, a shared `ConfirmDialog`, a Delete button on the skill card, and a Diff button in Versions (own LCS, no new dependency). Agents moved into the SKILLS LAB nav section; the conventions feature-model default is now a cheap OpenRouter model.
Green: typecheck in server/client/reviewer-core, `arch:check` (176 modules), `next build` (both new routes), and a throwaway test-inclusive tsconfig over the four new server test suites. Tests were WRITTEN but NOT run (standing rule) — one exception, `CandidateCard.test.tsx` was run once before the rule was recalled. Migration 0013 is generated, NOT applied locally. The API Contract Reviewer agent and its four skills stay deliberately unseeded — texts in `specs/fixtures/api-contract-reviewer/`, prompt in `docs/agent-prompts/`. Open decisions are listed in `specs/hw2-open-questions.md`.

### 2026-09-22 — homework 2 specs: Conventions Extractor + API Contract Reviewer
Spec-only session, no package code touched. Wrote `specs/conventions-extractor.md` (scan job over configs + `getConventionSamples`, one structured call, code-side evidence verification, `status` enum replacing `conventions.accepted`, new `convention_scans` table, preview→commit skill creation, page/card/modal, four lab gaps: Agents in SKILLS LAB, confirm dialogs, `/skills/[id]`, Versions diff), `specs/api-contract-reviewer.md` (agent via UI, four skills, A/B experiment, system prompt), the four skill texts under `specs/fixtures/api-contract-reviewer/` (deprecation-policy carries a `scripts/` decoy for the zip import), and `specs/hw2-criteria.md` with the 53 criteria plus a coverage matrix. Criteria 1–2 (AGENTS.md) left as not applicable. Nothing run, nothing committed.

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

- **Unverified: whether `skills:` preload still injects a skill into an agent that denies the `Skill` tool — no agent here combines the two.** (2026-10-04) The four agents with `skills:` (`architecture-reviewer`, `security-reviewer`, `implementer`, `doc-writer`) all list `Skill` in `tools`; the five that deny it (`spec-creator`, `implementation-planner`, `brainstorm`, `plan-verifier`, `researcher`) carry no `skills:` and read `SKILL.md` with `Read`. `check-agents.sh` checks only that a preloaded skill's `SKILL.md` exists.
  → Before adding `skills:` to a `Skill`-denied agent, run it once and have it quote a line of the preloaded skill; until that passes, keep the `Read` pointer in the agent text.

- **Unverified: the Test Quality A/B control experiment (hw2 criterion 17) probably measures nothing — its base prompt already carries what the skills add.** (2026-09-23) `server/src/db/seed-prompts.ts:305-321` asks for uncovered branches and missing corner cases and calls "Happy path only" the most common finding, so the run WITHOUT skills is likely to flag the happy-path-only test too. `API_CONTRACT_REVIEWER_PROMPT` avoids exactly this on purpose (comment at `seed-prompts.ts:398-403`).
  → Run A once before recording the demo; if it flags the gap, move that knowledge out of the Test Quality prompt into its skills, as was done for the API Contract Reviewer.

- **Unresolved: `INFO` is a fourth severity that only the client design system knows about.** (2026-09-17) The contract enum carries three values (`server/src/vendor/shared/contracts/findings.ts:11`), while `client/src/vendor/ui/primitives/tokens.ts:13` declares `INFO` and two client constant maps keep an entry for it; nothing in the engine, the API or the DB can produce one, so those branches are unreachable today.
  → Decide whether to promote it (contract + the four engine tables listed in `reviewer-core/docs/severity.md`) or delete it; `reviewer-core/specs/severity-source-of-truth.md` carries the spec either way.
