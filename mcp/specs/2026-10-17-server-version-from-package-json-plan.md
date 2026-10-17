# Implementation Plan — MCP server version from package.json
Source: `mcp/specs/2026-10-17-server-version-from-package-json.md` (SPEC-11, Status: approved) · Base: `79a6886` · Packages: mcp
Execution mode: single-agent (chosen by the user).

## 0. Before the first edit
- **Instructions read:** `CLAUDE.md` → `AGENTS.md` (root), `mcp/CLAUDE.md` → `mcp/AGENTS.md`, `.claude/sdd-profile.md`. Three project rules shape this plan:
  - "stdout is protocol-only".
  - "`process.env` is referenced in `index.ts` only; `config.ts` reads from the object it is given". So the file read stays in `index.ts` and `config.ts` only gets a pure parser.
  - "Tests are `*.test.ts` beside the code".
  - Root AGENTS overrides the user's global no-tests rule: tests may be run without asking.
- **INSIGHTS:** `mcp/INSIGHTS.md` read in full. No entry bears on this change.
- **INSIGHTS:** root `INSIGHTS.md` § Recurring Errors, "A plan's absence check on generic words can never print nothing". Because of it, the absence check in § 6 is narrowed to `version: '…'` literals. At base it matches only `mcp/src/definitions.ts:3`.
- **Routing:** `engineering-paved-path:skill-routing` → typescript-expert, zod. Security is not cited: no untrusted input reaches this change.

## 1. Scope — as the source states it
**Goals**
- G-1: a client that connects is told, in `serverInfo.version`, the version `mcp/package.json` declares.
- G-2: the version is declared in one place: changing `version` in `mcp/package.json` is the only edit needed.

**Non-goals**
- NG-1: changing the version number itself (stays `0.0.0`) [NEEDS CLARIFICATION → OQ-1].
- NG-2: a build step or emitted output — the server runs from source through `tsx`.
- NG-3: changing `serverInfo.name` (stays `devdigest-mcp`).
- NG-4: the version a test client announces about itself.

**Acceptance criteria**
- AC-1: WHEN an MCP client completes `initialize`, `serverInfo.version` equals the `version` field of `mcp/package.json`.
- AC-2: `serverInfo.name` stays `devdigest-mcp` (already there, kept).
- AC-3: `serverInfo.version` comes from `mcp/package.json` and from no version value written anywhere else in the package.
- AC-4: WHEN the real stdio entry is started from a working directory other than `mcp/`, `serverInfo.version` equals the `version` field of `mcp/package.json`.

**Edge cases**
- EC-1: started from the client's own working directory — covered by AC-4.
- EC-2: `mcp/package.json` unreadable or without a `version` string → the server does not start: one `server.startup_failed` line to stderr, exit code 1 (OQ-2 = a).
- EC-3: a pre-release or build suffix is reported character for character.

**NFRs**
- NFR-1: depcruise layer map unchanged; `npm run arch:check` stays clean.
- NFR-2: `check-code.sh mcp` passes.
- NFR-3: runs from source through `tsx` and `node --import tsx`, no build.
- NFR-4: reading the version writes nothing to stdout.

**Open questions, planned with recorded defaults:** OQ-1 = a (no version bump; add a check that discriminates), OQ-2 = a (fail at startup), OQ-3 = a (`server.ready` unchanged).

## 2. Impact map
| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| mcp | `mcp/src/config.ts` | Modify | root (composition): pure `parseServerVersion` | AC-1, AC-3, EC-2, EC-3 |
| mcp | `mcp/src/config.test.ts` | Modify | test beside code | EC-2, EC-3 |
| mcp | `mcp/src/definitions.ts` | Modify | surface: `SERVER_INFO` → `SERVER_NAME` | AC-2, AC-3 |
| mcp | `mcp/src/server.ts` | Modify | surface: `ServerOptions.version` | AC-1, AC-3 |
| mcp | `mcp/src/index.ts` | Modify | root: reads `../package.json` inside `main()` | AC-1, AC-4, EC-2, NFR-4 |
| mcp | `mcp/src/server.test.ts` | Modify | test | AC-1, AC-2, AC-3 |
| mcp | `mcp/src/stdio.test.ts` | Modify | test | AC-4, EC-1, NFR-3, NFR-4 |

No new files. No dependency changes (`zod` 3.25.76 is already a dependency). No migration, no contract copy, no i18n.

## 3. Constraints in play
**R1 settled: how the version is read.** A static JSON import (`import pkg from '../package.json' with { type: 'json' }`) would type-check (TS 5.9.3, `moduleResolution: Bundler`, `resolveJsonModule: true`, no `rootDir`, `noEmit`) and tsx 4.23 loads it. It is rejected for EC-2: a failed static import throws while the module loads, before `main()` runs, so the `main().catch` path at `mcp/src/index.ts:28-32` never writes `server.startup_failed`.

Chosen: a runtime read. `index.ts` calls `readFileSync(new URL('../package.json', import.meta.url), 'utf8')` inside `main()`. No tsconfig change; resolves from the module's location, not the working directory (EC-1).

**Other constraints**
- **Layering** (`mcp/.dependency-cruiser.cjs`): `config.ts` and `index.ts` are the root ring; `definitions.ts` and `server.ts` gain no new imports beyond local ones. Domain files untouched (NFR-1).
- **AGENTS conventions:** `config.ts` stays a pure function of its input, so file I/O lives in `index.ts`. No `console.log`; errors propagate to the existing catch.
- **Naming:** a Zod schema and its inferred type share one PascalCase name (`PackageManifest`).
- **Unchanged contracts:** tool descriptions and `INSTRUCTIONS` untouched; `mcp/README.md:34` registration command unchanged (NFR-3).

## 4. Stages

### Stage 1 — Pure manifest parser
Track: main · After: —

**Files:** `mcp/src/config.ts`, `mcp/src/config.test.ts`

**Read first:** `mcp/src/config.ts` (root-ring pure-parser pattern); `mcp/src/config.test.ts:1-25` (test style).

**Steps:**
1. In `config.ts`, add module-private `const PackageManifest = z.object({ version: z.string() })` and `type PackageManifest = z.infer<typeof PackageManifest>`; import `z` from `zod`.
2. Add `export function parseServerVersion(manifestText: string): string`.
   - `JSON.parse` in a try; on `SyntaxError` throw `new Error('mcp/package.json is not valid JSON.')`.
   - `PackageManifest.safeParse`; on failure throw `new Error('mcp/package.json has no "version" string.')`.
   - Return `data.version` unmodified (EC-3).
3. No `as` casts, no `any`.

**Skills:** `engineering-paved-path:zod` → `references/parse-never-trust-json.md`; `engineering-paved-path:typescript-expert` → `SKILL.md` § Code Review Checklist / Type Safety.

**Tests to add** (`config.test.ts`, `describe('parseServerVersion')`):
- `'{"version":"1.2.0-rc.1+abc"}'` returns `'1.2.0-rc.1+abc'` (EC-3, AC-1).
- A manifest with no `version`, one with `"version": 3`, and `'not json'` each throw an Error whose message contains `mcp/package.json` (EC-2).

**Done when:** `.claude/agents/scripts/check-code.sh mcp -- src/config.test.ts` passes.

### Stage 2 — Server takes the version; the root reads the manifest
Track: main · After: 1

**Files:** `mcp/src/definitions.ts`, `mcp/src/server.ts`, `mcp/src/index.ts`, `mcp/src/server.test.ts`

**Read first:** `mcp/src/definitions.ts:1-5`, `mcp/src/server.ts:1-45`, `mcp/src/index.ts`; `mcp/src/server.test.ts:1-20,68-80,218-229`.

**Steps:**
1. `definitions.ts:3`: replace `SERVER_INFO` with `export const SERVER_NAME = 'devdigest-mcp';`.
2. `server.ts`: add a required `version: string` to `ServerOptions`; import `SERVER_NAME`; build `new McpServer({ name: SERVER_NAME, version }, { instructions: INSTRUCTIONS })`. No default value.
3. `index.ts`: inside `main()`, after `loadConfig(process.env)`, add `const version = parseServerVersion(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));` (import `readFileSync` from `node:fs`, `parseServerVersion` from `./config.js`); pass `version` to `createServer`. Must stay inside `main()` so failures reach the `server.startup_failed` catch (EC-2). `server.ready` line unchanged (OQ-3 = a).
4. `server.test.ts`: add module-level `PACKAGE_VERSION = parseServerVersion(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))`; make `connect()` pass `version: PACKAGE_VERSION` before `...over`. Keep the existing initialize assertion, which compares against an independent `JSON.parse(...).version` (AC-1, AC-2).

**Skills:** `engineering-paved-path:typescript-expert` → `SKILL.md` § Code Review Checklist / Type Safety. The required option (no default) makes a hard-coded literal in `server.ts` impossible.

**Tests to add** (`server.test.ts`, in `describe('initialize')`): `it('reports the version it is given and no other (AC-3)')` — `connect(world(), { version: '9.9.9-from-manifest' })`, expect `getServerVersion()` to equal `{ name: 'devdigest-mcp', version: '9.9.9-from-manifest' }`. Fails if any literal feeds `serverInfo`, even while the manifest reads `0.0.0`.

**Done when:**
- `.claude/agents/scripts/check-code.sh mcp` passes (typecheck, depcruise, tests).
- `grep -rnE "version: *['\"]" mcp/src --include='*.ts' --exclude='*.test.ts'` prints nothing.

### Stage 3 — The real entry, started from outside `mcp/`
Track: main · After: 2

**Files:** `mcp/src/stdio.test.ts`

**Read first:** `mcp/src/stdio.test.ts` (spawn pattern, `childEnv`, `PACKAGE_DIR`); `mcp/README.md:29-39` (registered command: absolute `tsx` on absolute `src/index.ts`, no cwd).

**Steps:**
1. Add `PACKAGE_VERSION` read as in Stage 2: independent `JSON.parse(readFileSync(...)).version`, without importing `parseServerVersion`.
2. In the first existing test, add `expect(client.getServerVersion()?.version).toBe(PACKAGE_VERSION)` (covers the `node --import tsx` entry, NFR-3).
3. New `it('reports the package.json version when started from another working directory, as registered (AC-4, EC-1)')`:
   - `mkdtempSync(join(tmpdir(), 'devdigest-mcp-cwd-'))` for a fresh dir.
   - `StdioClientTransport` with `command: join(PACKAGE_DIR, 'node_modules/.bin/tsx')`, `args: [join(PACKAGE_DIR, 'src/index.ts')]`, `cwd` = that dir, `env: childEnv({ DEVDIGEST_API_URL: UNREACHABLE })`.
   - Connect; assert `getServerVersion()?.version` equals `PACKAGE_VERSION` and `client.onerror` collected nothing (NFR-4).
   - Remove the dir in `finally` with `rmSync(..., { recursive: true, force: true })`.
   - Use the `tsx` binary, not `node --import tsx`: the latter resolves the specifier from the cwd and would not find it from a temp dir.

**Skills:** `engineering-paved-path:typescript-expert` → `SKILL.md` § Code Review Checklist / Type Safety.

**Done when:** `.claude/agents/scripts/check-code.sh mcp` passes.

## 5. Skills matrix
| Stage | zod | typescript-expert |
|---|---|---|
| 1 | `references/parse-never-trust-json.md` | `SKILL.md` § Code Review Checklist |
| 2 | — | `SKILL.md` § Code Review Checklist |
| 3 | — | `SKILL.md` § Code Review Checklist |

## 6. Verification
| Package | Command (from the repository root) | Proves |
|---|---|---|
| mcp | `.claude/agents/scripts/check-code.sh mcp` | typecheck (NFR-2), depcruise (NFR-1), tests for AC-1…AC-4, EC-1…EC-3, NFR-3, NFR-4 |
| mcp | `grep -rnE "version: *['\"]" mcp/src --include='*.ts' --exclude='*.test.ts'` must print nothing | AC-3 / G-2: no version literal left in sources |
| mcp | `git diff --quiet 79a6886 -- mcp/README.md mcp/package.json mcp/tsconfig.json mcp/.dependency-cruiser.cjs` | NG-1, NG-2, NFR-1, NFR-3: registration, version, config and layer map unchanged |

## 7. Risks and open questions
- [non-blocking] OQ-1 / OQ-2 / OQ-3 planned with the spec's recorded defaults (a / a / a).
- [non-blocking] The wiring line in `index.ts` is not discriminated by a test: while `mcp/package.json` reads `0.0.0`, a literal `'0.0.0'` passed from `index.ts` would still pass the stdio equality check. Caught by the § 6 grep and by review. See REC1.
- [non-blocking] `"version": ""` and an unreadable `package.json` at the stdio level are not exercised; `parseServerVersion`'s throws are unit-tested and the failure path is the existing catch at `index.ts:28-32`.
- [non-blocking] Started outside `mcp/`, `tsx` finds no `tsconfig.json` and uses defaults — same as the registered command today.

## 8. Handoff to reviewers
- **Architecture:** file read in `index.ts`, pure parser in `config.ts`, both root; no new file or port. Check that `server.ts` gives `version` no default and that the read is inside `main()`, not at module top level.
- **Security:** nothing new — fixed file of the package's own, no user-supplied path, no new input, route, secret or stdout output.

## 9. Execution
Mode: single-agent. One package, three chained stages sharing `server.ts` and its test.

| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| main | 1–3 | `mcp/src/{config,config.test,definitions,server,server.test,index,stdio.test}.ts` | — | alone |

Briefs, each run by a fresh `implementer`:
- main · stages 1–2 → "Execute stages 1–2 of mcp/specs/2026-10-17-server-version-from-package-json-plan.md (track main). Write only inside: mcp/src/config.ts, mcp/src/config.test.ts, mcp/src/definitions.ts, mcp/src/server.ts, mcp/src/index.ts, mcp/src/server.test.ts. Check with: .claude/agents/scripts/check-code.sh mcp."
- main · stage 3 → "Execute stage 3 of mcp/specs/2026-10-17-server-version-from-package-json-plan.md (track main). Write only inside: mcp/src/stdio.test.ts. Check with: .claude/agents/scripts/check-code.sh mcp."

## 10. Recommendations — not applied
- REC1 [requirements]: take OQ-1 option c — bump `mcp/package.json` off `0.0.0` (e.g. `0.1.0`) in addition to the planned check.
  - Why: while both values read `0.0.0`, the stdio equality checks cannot tell a manifest read from a literal passed in `index.ts`; only the § 6 grep covers that line.
  - Would change: NG-1 (spec revision via `spec-creator`), plus one Stage 2 step editing `mcp/package.json`'s `version` and refreshing the lockfile via `npm install --package-lock-only` in `mcp/`.
