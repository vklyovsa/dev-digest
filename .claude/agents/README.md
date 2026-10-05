# Agents

Project subagents for Claude Code. This file is the map of the set; the rules live in each
agent's own file. It has no frontmatter, so Claude Code treats it as documentation, not as an
agent.

## Pipeline

```mermaid
flowchart LR
  requirements([user: feature, design sources, stated requirements]) --> speccreator[spec-creator]
  speccreator -. questions: blocking first, the rest with the draft .-> requirements
  speccreator -->|specs/date-slug.md, approved by the user| planner[implementation-planner]
  requirements -->|stated requirements, no spec| planner
  planner -. questions: requirements, execution mode .-> requirements
  brainstorm -. chosen option .-> planner
  planner -->|specs/slug-plan.md| implementer
  implementer -->|uncommitted diff + report| verifier[plan-verifier]
  verifier --> arch[architecture-reviewer]
  verifier --> security[security-reviewer]
  verifier -->|ACs without a test| testwriter[test-writer]
  arch --> docwriter[doc-writer]
  security --> docwriter
  testwriter --> docwriter
  docwriter --> gate{{pr-self-review gate}}
  gate --> user([user commits])
  verifier -. missing / partial .-> implementer
  arch -. CRITICAL / WARNING .-> implementer
  security -. CRITICAL .-> implementer
  testwriter -. gaps .-> implementer
  implementer -. fixes: recheck those items .-> verifier
  researcher -. evidence for any step .-> planner
  speccreator -. research needed .-> researcher
  researcher -. reports .-> speccreator
```

**Order after the plan.** Implementers, one brief (one or two stages) each, in parallel
across tracks → `scripts/check-code.sh` once over every touched package, run by the calling
session → `plan-verifier` → `architecture-reviewer` ∥ `security-reviewer` ∥ `test-writer`
→ `doc-writer` → the `pr-self-review` gate. `plan-verifier` goes first: it is the cheapest
check, and a review or a test written against an incomplete diff is paid for twice. The
three after it run together — the reviewers write nothing and `test-writer` writes test
files only. Whatever they send back goes to an `implementer`, and then to the **same**
`plan-verifier` instance, which rechecks only those items.

**Command.** [`/implement`](../commands/implement.md)
`<plan or spec path> [design paths…] [--security] [notes]` runs the build half for the
calling session: implementers (one brief each) → `check-code.sh` → `plan-verifier` →
`architecture-reviewer`, with fix rounds until no CRITICAL or WARNING is open — at most
three, then the user decides. `spec-creator` and `implementation-planner` are run by hand
before it; `test-writer` and `doc-writer` are not part of it, `security-reviewer` only with
`--security`. It starts only when the user types it.

Subagents cannot ask the user questions (`AskUserQuestion` is stripped from every subagent).
Each agent returns a `Clarification needed` / `Blocked` block instead, and the calling session
asks. `implementation-planner` also returns `Questions for the user` with its plan — unclear
requirements and the execution mode (multi-agent or single-agent). `spec-creator` returns
the same block twice: its blocking questions before it writes anything, then the
non-blocking ones and its design proposals together with the draft — and `Research needed`
for the facts it cannot look up itself. The calling session puts the questions to the user
with `AskUserQuestion` and never answers them itself. A new
`.claude/agents/<name>.md` is picked up by a running session (Claude Code 2.1.280).

## Catalog

| Agent | Responsibility | Model | Tools | Denied / enforced | Input | Output |
|---|---|---|---|---|---|---|
| [brainstorm](brainstorm.md) | Compares 2–4 options for one decision before a plan exists, against weighted drivers taken from the project rules | opus | Read, Grep, Glob, Bash | Write, Edit, MultiEdit, NotebookEdit, Skill, Agent, Web*; `readonly-guard` | A decision or goal + a boundary | MADR-style options report + a ready task for the implementation-planner |
| [researcher](researcher.md) | Answers one concrete question with evidence — REPO (code, docs, specs, INSIGHTS, git history) or EXTERNAL (official docs, changelogs, issues, standards) | sonnet | Read, Grep, Glob, Bash (read-only by instruction), WebSearch, WebFetch | Write, Edit, NotebookEdit, Skill, Agent — so no `/deep-research`, no subagents | A concrete question with a purpose or scope | Research report: answer + confidence, findings with `file:line` / commit / URL, references, **Not found / unverified** |
| [spec-creator](spec-creator.md) | Writes the spec a feature is built from, in the shape of `specs/TEMPLATE.md`: EARS acceptance criteria with a verify ring, edge cases, non-functional requirements, module interactions, a review of the supplied design (missing states, corner cases, UX proposals), provenance, untrusted inputs, traceability. Turns every gap into a question, a research item or a proposal; ends with `check-spec.sh`; writes `Status: draft` only | opus | Read, Grep, Glob, Edit, Write, Bash | MultiEdit, NotebookEdit, Skill, Agent, Web*; `write-scope-guard --profile specs` | A feature in the user's words + the design sources the user supplies (text, Figma exports, existing code, the repository); later, the answers and `researcher` reports — sent to the same instance | `Questions for the user` and / or `Research needed` (blocking, nothing written), or a draft in `specs/` / `<pkg>/specs/` + a Specification report: non-blocking questions, proposals, the self-check output |
| [implementation-planner](implementation-planner.md) | Reviews the requirements it is given (questions, recommendations), then turns them into a staged Implementation Plan that fits the modules, INSIGHTS, architecture rules and the skills the implementer will load, with tracks for multi-agent execution. Writes no spec and invents no requirement | opus | Read, Grep, Glob, Bash; `permissionMode: plan` | Write, Edit, MultiEdit, NotebookEdit, Skill, Agent, Web*; `readonly-guard` | `specs/<slug>.md` or a task that states its requirements and a boundary; optionally the execution mode | `Clarification needed`, or an Implementation Plan (text) with `Questions for the user` — the calling session asks them, then saves the plan to `specs/<slug>-plan.md` once approved |
| [implementer](implementer.md) | Executes the stages of one brief from an approved plan in `server/`, `client/`, `reviewer-core/`: reads the files and skill rules each stage names, edits, adds tests, verifies with `check-code.sh` | sonnet | Read, Grep, Glob, Edit, Write, Bash, Skill (for `engineering-insights` only; no preload) | Agent, WebSearch, WebFetch, NotebookEdit; `implementer-guard` | `specs/<slug>-plan.md` with no `[blocking]` question open + a brief from its §9 (stages, write set, packages to check) | Implementation report: stages, deviations, skills applied, verification table, AC evidence, handoff to reviewers, blockers; plus the uncommitted diff |
| [test-writer](test-writer.md) | Writes client / server / reviewer-core tests from the plan's ACs and the spec (not from the current code), with the skills `routing.md` names, and runs them | sonnet | Read, Grep, Glob, Edit, Write, Bash, Skill | Agent, WebSearch, WebFetch, NotebookEdit; `write-scope-guard --profile tests` | A plan + stages, ACs without test evidence, or files + behaviours | Test report: tests written, static checks, test runs (passed/failed/skipped), gaps for the implementer |
| [plan-verifier](plan-verifier.md) | Traceability check: every plan item (§0–8) and every spec requirement / AC / non-goal → done, partial, missing or deviated, with `file:line`; plus changes no plan item covers | sonnet | Read, Grep, Glob, Bash | Write, Edit, MultiEdit, NotebookEdit, Skill, Agent, Web*; `readonly-guard --allow-tests` | `specs/<slug>-plan.md` (+ spec, + implementation report) | Verification report: spec → plan → code, plan items, ACs, unplanned changes, needs a test run, not verifiable |
| [architecture-reviewer](architecture-reviewer.md) | Architecture-boundary review of the diff: onion layering (depcruise and beyond), client placement and imports, path aliases, the two `@devdigest/shared` copies | sonnet | Read, Grep, Glob, Bash, Skill; preloads `onion-architecture`, `frontend-ui-architecture` | Write, Edit, MultiEdit, NotebookEdit, Agent, Web*; `readonly-guard` | The open diff (optional base, plan, report) | Findings in the shared contract + checks run + JSON |
| [security-reviewer](security-reviewer.md) | Exploitable vulnerabilities only: attacker-controlled source → sink, with band, confidence, CWE/OWASP and an exploit path. Not the product's Security Reviewer (`docs/agent-prompts/`) | opus | Read, Grep, Glob, Bash, Skill; preloads `security` | Write, Edit, MultiEdit, NotebookEdit, Agent, Web*; `readonly-guard` | The open diff (optional base, plan, report) | Findings in the shared contract + threat model + surfaces examined + JSON |
| [doc-writer](doc-writer.md) | Documents implemented features in the right place (`docs/`, package `docs/`, READMEs, `TESTING.md`) with Mermaid diagrams, and links them from `AGENTS.md` Read when | sonnet | Read, Grep, Glob, Edit, Write, Bash, Skill; preloads `mermaid-diagram` | Agent, WebSearch, WebFetch, NotebookEdit; `write-scope-guard --profile docs` | Subject + plan / spec / report / files | Documentation report: placement, files, links, checks, code-vs-plan discrepancies |

`pr-self-review` (a skill, not an agent) stays the only merge gate; the reviewer agents run
before it with the same scope scripts, routing and severity rubric, so a CRITICAL here is a
CRITICAL there.

## Shared contracts between agents

- **Self-containment** — every agent must behave as written for any developer, whatever their
  personal `~/.claude` settings, plugins or permission mode. Each agent states the rules it
  needs in its own file or names the project file that holds them; hard limits are enforced by
  the guards below, not by `permissionMode` (a session running in `bypassPermissions` forces
  its subagents into it).
- **Tests** — project policy (`../../AGENTS.md` § Conventions): tests may be run without
  asking. test-writer runs what it writes, plan-verifier may run the plan's §6 commands; the
  other read-only agents do not run tests. No agent runs browser e2e or starts the dev stack.
- **Verification** — `scripts/check-code.sh <package>…` is the one command for "does it
  still hold": typecheck, `depcruise` where the package has a config, and the tests, one
  line per step with an excerpt under a failed one (`--it` adds the server integration
  lane, `-- <test file>…` runs only those files, `--no-tests` the static half). A plan's
  §6 names it, `implementer` runs it per stage and once at the end, `plan-verifier` uses it
  to prove a criterion. The server tests cannot reach the dev DB whoever starts them:
  `server/vitest.config.ts` pins `DATABASE_URL` to an address nothing listens on.
- **Requirements** — the chain is `spec-creator` → `implementation-planner`: the first
  writes the spec, the second takes the approved spec as its input and writes the plan. A
  spec is written by `spec-creator` with the user, or by the user, in the shape of
  `../../specs/TEMPLATE.md` (`../../specs/README.md`); it may carry workflow and
  communication diagrams and contracts, and usually no implementation detail. `spec-creator`
  structures what the user supplied and turns every gap into a question or a proposal; it
  writes `Status: draft` only. The calling session sets `Status: approved` after the user
  approves in so many words, with no `[blocking]` question open — no agent does.
  `implementation-planner` plans an approved spec (or requirements stated in the task),
  copies requirements from their source and answers a gap with a question or a
  recommendation, never with its own wording; `brainstorm` weighs options.
- **Questions, research and the way back** — a `Questions for the user` block goes to the
  user through `AskUserQuestion`. A `Research needed` block (`spec-creator`) becomes one
  `researcher` per item, started in parallel. Answers and reports go back to the **same
  agent instance** with `SendMessage`, never to a fresh one: a new instance re-reads
  everything and loses its `IN-n` numbering and the questions it held for the draft.
- **Spec check** — `scripts/check-spec.sh` checks a spec against `specs/TEMPLATE.md`
  (formats, EARS form, references, coverage, traceability). `spec-creator` runs it as its
  final self-check, `implementation-planner` on its input, and the calling session with
  `--for-approval` before it sets `Status: approved`.
- **Execution mode** — multi-agent or single-agent is the user's choice.
  `implementation-planner` recommends one and lays out the tracks (plan §9). In either mode
  an `implementer` gets one brief — one or two stages and their write set — and the next
  brief goes to a fresh one: a run's cost grows with the square of its length
  (`../../INSIGHTS.md` § What Doesn't Work).
- **File → skill routing** — one table,
  [`../skills/pr-self-review/rules/routing.md`](../skills/pr-self-review/rules/routing.md),
  which `pr-self-review` also uses. `implementation-planner` routes every file of the
  impact map through it and cites the governing rules file in each stage; `implementer`
  reads those files and neither routes nor invokes a skill; `test-writer` loads the skill
  its target routes to. Change routing there (and in `route-skills.sh`, its executable
  twin), not in an agent.
- **Plan format** — sections 0–10 defined in `implementation-planner.md` (Step 6).
  `implementer` reads §0–3, its own stages of §4, §6–7 and its brief in §9;
  `plan-verifier` reads §0–8 plus the spec; §9 (mode and tracks)
  and §10 (recommendations, not applied) are for the user and the calling session. A change
  to Step 6 updates both agents.
- **Review finding** — `architecture-reviewer` and `security-reviewer` share one line,
  `Finding fields: severity · band · file · line · in_diff · skill · rule_source · title · evidence · failure · fix · verified`
  (`check-agents.sh` fails if the two drift). Gate severity comes from
  [`../skills/pr-self-review/rules/severity.md`](../skills/pr-self-review/rules/severity.md).
  Security adds a band (Critical/High/Medium/Low from reachability × impact × preconditions)
  and a confidence: HIGH + Critical/High → CRITICAL (three-part test still applies);
  Medium band or MEDIUM confidence → WARNING; Low or LOW → not reported.
- **Write scopes** — test-writer: test files only; doc-writer: doc files only; spec-creator:
  spec files only; the five agents under `readonly-guard`: nothing. See Guards.
- **Session protocol** — agents read `INSIGHTS.md` in full before acting
  (`../../AGENTS.md` § Session protocol); the writing agents close with `engineering-insights`.
  `spec-creator` writes nothing outside the spec folders, so it lists its insights in its
  report and the calling session records them.

## Guards

`PreToolUse` hooks declared in each agent's frontmatter; active only while that agent runs, on
top of the project hook in `../settings.json` (`guard-pr.sh`). All three share
[`scripts/guard-lib.sh`](scripts/guard-lib.sh).

| Guard | Used by | Allows | Blocks |
|---|---|---|---|
| `implementer-guard.sh` | implementer | everything else | git history / working-tree commands, branch delete/move, `gh pr` writes; `db:migrate`, `db:seed`, `drizzle-kit migrate/push/drop`, `dropdb`, `pg_restore`, `psql` writes; `docker compose down -v`, volume rm/prune; lockfiles, `server/package.json`, migrations, `server/clones/**`, `.env*` (not `.env.example`); the guards, `implementer.md`, this README, `.claude/settings*.json`; paths outside the repo |
| `readonly-guard.sh [--allow-tests]` | brainstorm, implementation-planner, plan-verifier (`--allow-tests`), architecture-reviewer, security-reviewer | Bash allowlist: read-only git, text tools (`grep`, `sed -n`, `find` without actions, `jq`, …), `typecheck`, `depcruise`, `tsc --noEmit`, `collect-diff.sh`, `route-skills.sh`, `check-agents.sh`, `check-guards.sh`, `check-spec.sh`, `check-code.sh --no-tests`, `bash -n`; `vitest run` and `check-code.sh` with `--allow-tests` | every file-writing tool; any other command; redirects into files, `--output`, `sed -i`, `find -delete/-exec`, `sort -o`; snapshot updates and watch mode |
| `write-scope-guard.sh --profile tests` | test-writer | Edit/Write on `*.test.ts(x)`, `server/test/**`, `reviewer-core/test/**`, `client/src/test/**` (not `setup.ts`), `tsconfig.test-check.json`; `vitest run`; `append-insight.sh` | production code, vendor contracts, specs, `.claude/**`, `INSIGHTS.md`, `CLAUDE.md`; the implementer-guard Bash denylist; installs, `dev.sh`, `e2e.sh`, `agent-browser`, `prettier --write`, `*:fix`; `rm/mv/cp/tee/sed -i/node -e`, file redirects |
| `write-scope-guard.sh --profile specs` | spec-creator | Edit/Write on `<YYYY-MM-DD>-<feature-slug>.md` in `specs/`, `server/specs/`, `client/specs/`, `reviewer-core/specs/`, `mcp/specs/` — a new file, or an existing one whose header says `Status: draft` — and on that folder's `README.md`. Bash: the `readonly-guard` allowlist (`--bash-only`), `check-spec.sh` and `date` included | every other path: source, tests, `docs/**`, `.claude/**`, `INSIGHTS.md`, `*-plan.md`, `TEMPLATE.md`, `fixtures/**`, `e2e/specs/**`, specs that are approved, implemented or older than the template; every Bash command off the allowlist — network, installs, tests, file-mutating commands, redirects, git state |
| `write-scope-guard.sh --profile docs` | doc-writer | Edit/Write on `docs/*.md`, `<pkg>/docs/*.md`, README files, `TESTING.md`, `AGENTS.md` files; `append-insight.sh` | the same as tests, plus every test runner and `check-code.sh`; `docs/agent-prompts/**`, `docs/design/**` |

Every guard fails closed: no `jq` → the payload is read with `node` (a project requirement);
neither → every tool call is blocked; any unexpected error exits 2, never 1 (Claude Code
treats exit 1 as "allow"). Bash parsing is deliberately naive and errs towards blocking; the
rules are also written in each agent's text because frontmatter hooks run only after the
workspace-trust dialog is accepted.

`readonly-guard.sh --bash-only` judges commands only and lets tools and paths through: the
specs profile hands its Bash calls to it, so `spec-creator` gets the allowlist for Bash and
the path rules above for files. Whether an existing spec may be changed is read from its
header at call time, so that rule has no row in `guard-cases.tsv`.

Check a change to the guards or agents without running them as hooks:

```bash
.claude/agents/scripts/check-guards.sh          # every row of scripts/guard-cases.tsv
.claude/agents/scripts/check-agents.sh          # frontmatter, skills, hooks, this catalog
.claude/agents/scripts/check-spec.sh <spec.md>  # a spec against specs/TEMPLATE.md
.claude/agents/scripts/check-code.sh server     # typecheck, layering and tests of a package
.claude/agents/scripts/readonly-guard.sh --check "git stash"   # exit 2
```

A new guard rule gets a row in `scripts/guard-cases.tsv` — both an allow and a deny case.

## Sources behind the agents

**Claude Code documentation** (read 2026-09-27):

| Rule | Source |
|---|---|
| Explore → plan → implement as separate phases; a self-contained plan executed in a fresh context | [Best practices](https://code.claude.com/docs/en/best-practices) |
| A fresh-context reviewer checks the diff against the plan and reports gaps, not style; evidence, not claims | [Best practices](https://code.claude.com/docs/en/best-practices) — adversarial review, "Give Claude a way to verify its work" |
| Frontmatter fields, `tools` / `disallowedTools`, `skills:` preload, hooks scoped to one agent, no `AskUserQuestion`, a `bypassPermissions` session overrides the agent's mode | [Subagents](https://code.claude.com/docs/en/sub-agents), [Permission modes](https://code.claude.com/docs/en/permission-modes) |
| Path-scoped writes are not a frontmatter field → hooks | [Permissions](https://code.claude.com/docs/en/permissions), [anthropics/claude-code#31940](https://github.com/anthropics/claude-code/issues/31940) (closed, not planned) |
| Hook exit codes (2 blocks, 1 does not) | [Hooks](https://code.claude.com/docs/en/hooks) |
| Find → verify → filter, a separate verification step against false positives | [Code Review](https://code.claude.com/docs/en/code-review), [Building effective agents](https://www.anthropic.com/research/building-effective-agents) |

**Reviewers:**

| Rule | Source |
|---|---|
| Report only exploitable issues; exclusion list; confidence ≥ 0.8; exploit scenario per finding | [claude-code-security-review — `security-review.md`](https://github.com/anthropics/claude-code-security-review/blob/main/.claude/commands/security-review.md), [`findings_filter.py`](https://github.com/anthropics/claude-code-security-review/blob/main/claudecode/findings_filter.py) |
| Band from reachability × impact × preconditions; four bands | [CVSS v4.0](https://www.first.org/cvss/v4.0/specification-document), [GitHub code scanning severity](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning-alerts), [OWASP Risk Rating](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology) |
| Prompt injection from PR content | [OWASP LLM Top 10 (2025)](https://genai.owasp.org/llm-top-10/), [CWE-1427](https://cwe.mitre.org/data/definitions/1427.html) |
| A finding = a named rule + the violating edge + `file:line` | [Building Evolutionary Architectures](https://nealford.com/books/buildingevolutionaryarchitectures.html) (fitness functions), [dependency-cruiser](https://github.com/sverweij/dependency-cruiser), [Onion](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/), [Hexagonal](https://alistair.cockburn.us/hexagonal-architecture) |
| Bidirectional traceability (spec → plan → code, code → plan) | [ISO/IEC/IEEE 29148 via ReqView](https://www.reqview.com/blog/requirements-traceability-matrix/); the four statuses are this project's convention |

**Writers and brainstorm:**

| Rule | Source |
|---|---|
| Acceptance criteria in EARS: five patterns, the condition kept apart from the system's response | Mavin, Wilkinson, Harwood, Novak — *Easy Approach to Requirements Syntax (EARS)*, IEEE RE'09; blocking-first questions and the two added sections (Module interactions, Design review) are this project's convention |
| Assertions from the spec, not from the current code; test as the user uses it | [LLM unit-test survey (arXiv 2511.21382)](https://arxiv.org/html/2511.21382), [Testing Library principles](https://testing-library.com/docs/guiding-principles/), [Write tests](https://kentcdodds.com/blog/write-tests) |
| Doc type by the reader's need; diagram type by C4 level | [Diátaxis](https://diataxis.fr/), [C4 model](https://c4model.com/), [Mermaid](https://mermaid.js.org/syntax/flowchart.html), [Docs as Code](https://www.writethedocs.org/guide/docs-as-code/) |
| Drivers before options, ≥ 2 options incl. a baseline, pros/cons, consequences | [MADR](https://adr.github.io/madr/), [Nygard ADR](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), [ADR mistakes](https://ozimmer.ch/practices/2026/09/12/ADRMistakes.html), [decision matrix](https://en.wikipedia.org/wiki/Decision-matrix_method); the stop rule is this project's convention |

Model split (opus for judgement across files, sonnet for rule-following execution) is a
project decision, not a documented rule. `architecture-reviewer` runs on sonnet since
2026-10-04, so that its fix rounds stay affordable: its Step 1 is deterministic and its
Step 2 checks named rule files, and a finding still needs a rule, a `file:line` and a
verified pattern. If its findings turn noisy or thin, the model is the first thing to revisit.

**Repository:**

| Rule | Source |
|---|---|
| Packages, commands, naming, do-not-touch, dual contract copies, test policy | `../../AGENTS.md` and the package `AGENTS.md` files |
| Test lanes, `*.it.test.ts`, direct vitest calls, self-skipping integration tests | `../../TESTING.md` |
| Layering rules | `../../server/.dependency-cruiser.cjs`, `../skills/onion-architecture/` |
| Frontend placement | `../skills/frontend-ui-architecture/` |
| Severity and the gate | `../skills/pr-self-review/rules/severity.md` |
| Doc placement | `../../docs/README.md` § Rules |
| Spec vs plan | `../../specs/README.md`; spec layout in `../../specs/TEMPLATE.md`; plan layout in `implementation-planner.md` Step 6 |
| INSIGHTS before the first edit, capture at the end | `../../AGENTS.md` § Session protocol, `../skills/engineering-insights/` |
