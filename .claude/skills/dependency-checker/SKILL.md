---
name: dependency-checker
description: "Audits the dependencies of the repository and of each package in it, and writes one fixed-shape report: Scope, a Mermaid dependency graph (internal path-alias links kept apart from external npm packages), a size breakdown table per package (own size, size with transitives, what removing it frees), Findings & Priorities in tiers P0 / P1 / P2 / Info, and a Summary of the 3-5 actions to take first. Use when the user runs /dependency-checker or asks to check, audit or analyse dependencies: what is heavy, unused, duplicated, deprecated, outdated, vulnerable, drifting between packages, or imported across a package boundary. Read-only: it recommends, it never installs, removes or upgrades anything. Trigger terms: dependency check, dependency audit, перевір залежності, аналіз залежностей, node_modules size, unused dependencies, version drift, outdated packages."
argument-hint: "[online] [save] [<package>…]"
allowed-tools: Read, Grep, Glob, Bash(node .claude/skills/dependency-checker/scripts/collect-deps.mjs *)
metadata:
  type: workflow
  tags: dependencies, audit, size, version-drift, mermaid, priorities
---

# Dependency Checker

Answers one question for a developer: **which dependencies does this repository carry, what
do they cost, and what should be fixed first.** The measuring is done by a script; the
judgement — is this signal real, how urgent is it, what exactly to do — is done here.

The report always has the same five sections, in the same order, under the same headings.
A reader who has seen one report can find anything in the next one.

Arguments: $ARGUMENTS

## Arguments

| Form | Meaning |
|---|---|
| `/dependency-checker` | every package, offline: nothing leaves the machine |
| `online` | also ask the npm registry for latest versions and known advisories |
| `<package>…` | detailed size tables for these package folders only (`server`, `client`, …) |
| `save` | also write the report to `docs/dependency-report.md`, replacing the previous one |

## Step 0 — Where the facts come from

- **The request already contains the data** (package.json contents, sizes, grep results
  pasted into the prompt) → do not ask for tools, files or more data, and do not run
  anything. Go to Step 2 and build the report from what was given. A number that was not
  given is written `—`, never estimated, and a check that was not in the data (a lockfile,
  an install, a config scan) is listed under `Not covered:`, never claimed as done.
- **Otherwise** → Step 1.

## Step 1 — Collect

One call. It reads `package.json`, the lockfile, the installed `node_modules`, source
imports, `tsconfig.json` path aliases, compose files and GitHub workflows of every package,
and never runs a package manager, so it cannot touch a lockfile.

```bash
node .claude/skills/dependency-checker/scripts/collect-deps.mjs            # offline
node .claude/skills/dependency-checker/scripts/collect-deps.mjs --online   # + latest, advisories
node .claude/skills/dependency-checker/scripts/collect-deps.mjs --package server --package client
```

It prints sections 1–3 of the report ready-made, then a `SIGNALS` table, then the path of a
`facts.json` holding everything in full. Sections 1–3 go into the report **verbatim** — do
not re-measure, round, reorder or redraw them. Open `facts.json` only for a detail the
tables do not show (the full advisory list, every duplicate).

If a package has no `node_modules`, the script says so: report it in Scope and tell the
user which install to run. Do not install anything yourself.

## Step 2 — Tell internal from external

Every dependency is exactly one of three kinds, and the report never mixes them:

| Kind | What it is | How it shows up |
|---|---|---|
| **internal** | one package of this repository using another | a `tsconfig` path alias, a vendored copy, or a relative import that leaves the package folder |
| **external** | an npm package | `dependencies` / `devDependencies` in a `package.json` |
| **infra** | what the stack runs on | Docker images, GitHub Actions |

This repository is **not a workspace**: packages are linked by path aliases and vendored
copies, each with its own lockfile. Never describe a link as `workspace:*`, a pnpm/npm
workspace or a published module, and never recommend "hoist it to the root" — there is no
root `package.json`.

An internal link is healthy when it goes through the alias or the package's public entry
point. A relative import that reaches into another package's `src/` bypasses that entry
point: it is a boundary violation, reported as P0 whatever its size.

## Step 3 — Turn signals into findings

A signal is a rule that fired on the numbers. It becomes a finding only after it is
checked; the checks and the usual verdicts are in
[references/signals.md](references/signals.md). In short:

1. **Verify.** Open the import site, the config, the script. A dependency reported unused
   may be loaded by name, by a CLI or by a framework; an import reported undeclared may sit
   inside a test fixture string. A signal that does not survive is dropped silently.
2. **Merge.** The same cause seen in several packages is one finding that lists them all
   (one `vitest` advisory in five packages is one finding, not five).
3. **Rank.** Give it exactly one tier from the table below. When two tiers fit, the higher
   one wins. Size alone never lifts a finding above P2.
4. **Recommend.** One imperative sentence naming the dependency, the file and the command,
   in that package's own package manager.

### Priority tiers

| Tier | Meaning | Belongs here |
|---|---|---|
| **P0** | Broken or exploitable now. Fix before the next merge. | A relative import into another package's `src/` that bypasses its alias or public entry point · source importing a package its own `package.json` does not declare · a critical or high advisory in a runtime tree · one shared library at different **major** versions on two sides of a shared contract · vendored copies of one contract that differ in a file both sides use · a declared dependency missing from the install |
| **P1** | Will bite soon. Plan it this sprint. | A runtime dependency nothing imports · minor or patch **version drift** of a library whose types cross a package boundary (`zod` and the like) · a deprecated direct runtime dependency · a runtime dependency one or more majors behind with advisories fixed only upstream · a critical advisory in a dev-only tree · a runtime dependency used only by tests, or a devDependency imported by shipped source · no lockfile |
| **P2** | Cost, not risk. Fix when working nearby. | A heavy dependency used from one or two files · the same package installed in several versions · an unused devDependency · a deprecated transitive dependency · dev tooling a major behind · high advisories in a dev-only tree · moderate and low advisories |
| **Info** | Worth knowing, nothing to do now. | Tag-pinned Docker images and Actions · drift in declared ranges only, same installed version · a licence other than MIT / ISC / BSD / Apache-2.0 · a link the repository documents as intentional · what could not be measured |

A link or exception the repository documents on purpose (`AGENTS.md`, a package
`AGENTS.md`, `INSIGHTS.md`) is Info with a pointer to that line — never a defect.

## Step 4 — Write the report

Exactly these five sections, with these headings, in this order. Nothing after Summary.

```markdown
# Dependency report — <repository>

## 1. Scope
<Snapshot, mode, which packages were analysed — every one named, even one with nothing
to report — and what was read. One table row per package. Then one line "Not covered:"
for what this run could not see.>

## 2. Dependency graph
<A ```mermaid flowchart. Internal links first, external packages second — as two diagrams
or as two clearly separate groups in one. Below it, the table of internal links.>

## 3. Size breakdown
<One table per package: dependency, type, declared, installed, sizes, used by.
Then the dependencies declared by two or more packages, with the drift column.>

## 4. Findings & Priorities
### P0 — fix before the next merge
### P1 — plan this sprint
### P2 — fix when working nearby
### Info
<Under each tier the findings table, or the single word "None.">

## 5. Summary
<3–5 numbered actions, most urgent first.>
```

**Section 1 — Scope.** From the script, plus the `Not covered:` line. It always names
these limits when they apply: installed size is disk size, not what reaches a browser
bundle; offline mode knows no advisories and no latest versions; runtime coupling over
HTTP between packages is invisible to an import scan; usage is a text scan, so a
dependency loaded through a computed name can look unused.

**Section 2 — Dependency graph.** From the script, verbatim. When the facts were given in
the prompt, draw it yourself: `flowchart LR`, one node per package, internal links as
thick arrows (`==>`) labelled with the alias or `relative import`, external dependencies
as rounded nodes with thin arrows, a dependency shared by several packages drawn once.
At most 25 nodes — keep shared and heaviest dependencies, fold the rest into `+N more`.
Mark a boundary violation on its edge label.

**Section 3 — Size breakdown.** From the script, verbatim. From given facts: a real table
with one row per dependency and its size in a column — never a sentence like "some
packages are large". Sort by size, largest first, inside each package.

**Section 4 — Findings & Priorities.** All four tier headings are always present. Each
tier holds this table; IDs run `F1`, `F2`, … through the whole section in priority order:

| ID | Kind | Where | Dependency | Evidence | Recommendation | Effort |
|---|---|---|---|---|---|---|
| F1 | internal / external / infra | package and file, e.g. `server/package.json` or `server/src/x.ts:12` | name and version | the number or the line that proves it | what to do, with the command | S / M / L |

- **Where** is a path a developer can open, never just a package name.
- **Evidence** is a fact from the tables or from a file you opened: a size, a count of
  importing files, two version numbers, an advisory ID. No adjectives.
- **Effort**: S — one command or one line; M — touches code in a few files; L — a
  migration with breaking changes.

**Section 5 — Summary.** Three to five numbered actions, ordered by tier and then by
effort, each one sentence: verb, dependency, file, expected effect. They are the top of
section 4, not new material. Fewer than three findings → say so and list what there is.

## Wording rules

- **Name things.** Every finding and every action names a dependency and a file or a
  `package.json`. "Consider optimising dependencies" is not a finding.
- **Recommend, never report as done.** This skill changes nothing. Removal, upgrade and
  move are written as proposals for the user to confirm — "Remove `moment` from
  `server/package.json` (`cd server && pnpm remove moment`) after confirming nothing loads
  it by name" — never "removed".
- **Commands use the package's own manager**, the one shown in Scope, run inside that
  package's folder. A lockfile is changed only by its package manager, never by hand.
- **No invented numbers.** A size, version or count is copied from the facts or written `—`.
- **Headings, tier names and table columns stay in English** exactly as above; sentences
  follow the language the user wrote in.
- **Unchanged is not a finding.** A dependency with nothing wrong appears in section 3 only.

## Finishing

Print the report to the chat. With `save`, also write it to `docs/dependency-report.md`.
The `SIGNALS` table is working material: it never appears in the report. Do not start a
fix, an install or an upgrade from this skill — hand the Summary over and stop.
