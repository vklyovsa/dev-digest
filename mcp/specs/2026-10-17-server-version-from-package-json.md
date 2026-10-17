# Spec: MCP server version from package.json
Spec ID: SPEC-11
Status: approved
Supersedes: none

## Problem and user

A coding agent (and the person behind it) that connects to the DevDigest MCP server learns the
server's identity from the `serverInfo` of the MCP `initialize` response. Today that version is
the literal `'0.0.0'` written in the server's sources (`mcp/src/definitions.ts:3`), independent
of the `version` field of `mcp/package.json` (`mcp/package.json:3`). The two only agree by
coincidence: a maintainer who bumps `mcp/package.json` has to remember a second place, and when
they forget, every client is told a version that is not the one running. Known from the task
text (IN-1) and the code (IN-2, IN-4).

## Goals / Non-goals

- **G-1** A client that connects to the MCP server is told, in `serverInfo.version`, the version that `mcp/package.json` declares.
- **G-2** The server version is declared in one place: changing the `version` field of `mcp/package.json` is the only edit needed for the server to report a new version.
- **NG-1** Changing the version number itself (it stays `0.0.0` in `mcp/package.json`) — not asked for [NEEDS CLARIFICATION: whether to bump it so the existing equality check can tell the two sources apart → OQ-1].
- **NG-2** A build step or emitted output for the package — the server runs from source through `tsx` (`mcp/package.json:8`, `mcp/README.md:35`, `mcp/tsconfig.json` has `noEmit: true`), and this feature keeps it so.
- **NG-3** Changing `serverInfo.name` — it stays `devdigest-mcp` (decision 3 of `specs/devdigest-mcp-plan.md`).
- **NG-4** The version a test client announces about itself (`mcp/src/server.test.ts:72`, `mcp/src/stdio.test.ts:36`) — that is the client's identity, not the server's.

## User stories

- **US-1** As a coding agent connected to the DevDigest MCP server, I want the `initialize` response to carry the package's real version, so that the person debugging a session can tell which release of the server answered.
- **US-2** As a maintainer of the `mcp` package, I want to bump the version only in `mcp/package.json`, so that the reported version cannot drift from the declared one.

## Acceptance criteria (EARS)

- **AC-1** [event-driven] WHEN an MCP client completes the `initialize` handshake, the MCP server shall report `serverInfo.version` equal to the `version` field of `mcp/package.json`. — covers: US-1 · verify: unit — an in-memory client's `getServerVersion().version` equals the `version` read from `mcp/package.json` in the same test
- **AC-2** [event-driven] WHEN an MCP client completes the `initialize` handshake, the MCP server shall report `serverInfo.name` as `devdigest-mcp`. — covers: US-1 · verify: unit — an in-memory client's `getServerVersion().name` is `devdigest-mcp`
- **AC-3** [ubiquitous] The MCP server shall take `serverInfo.version` from the `version` field of `mcp/package.json` and from no version value written anywhere else in the package. — covers: US-2 · verify: unit — the check fails when the reported version comes from a value other than `mcp/package.json`, even while that value and `mcp/package.json` both read `0.0.0` [NEEDS CLARIFICATION: how the check tells a value read from mcp/package.json from a matching literal → OQ-1]
- **AC-4** [event-driven] WHEN the real stdio entry is started from a working directory other than `mcp/`, the MCP server shall report `serverInfo.version` equal to the `version` field of `mcp/package.json`. — covers: US-1 · verify: unit — the stdio test spawns the entry with a working directory outside `mcp/` and compares `getServerVersion().version` with `mcp/package.json`

## Edge cases

- **EC-1** The MCP client starts the server from its own working directory — the registered command (`mcp/README.md:35`) names `tsx` and `src/index.ts` by absolute path and sets no working directory → the reported version is still the one in `mcp/package.json` — covered by: AC-4
- **EC-2** `mcp/package.json` cannot be read, or has no `version` string → the server does not start: it writes one `server.startup_failed` line to stderr and exits with code 1, the existing startup-failure path (`mcp/src/index.ts:28-32`) [NEEDS CLARIFICATION: fail at startup or report a fallback version → OQ-2] — open: OQ-2
- **EC-3** The version carries a pre-release or build suffix (`1.2.0-rc.1`, `1.2.0+abc`) → it is reported character for character as `mcp/package.json` holds it — covered by: AC-1

## Non-functional requirements

- **NFR-1** [compatibility] The layer map of `mcp/.dependency-cruiser.cjs` is not changed and still holds: the version is not read inside a domain file (`text`, `findings`, `resolve`, `constants`), which rule `domain-stays-pure` limits to domain, port and error imports — verify: `npm run arch:check` in `mcp/` reports no violation
- **NFR-2** [compatibility] The package keeps type-checking and its whole check passes — verify: `.claude/agents/scripts/check-code.sh mcp` (typecheck, layering, tests) passes
- **NFR-3** [compatibility] The server keeps running from source with the command registered in `mcp/README.md` (`tsx` on `src/index.ts`) and with the `node --import tsx src/index.ts` entry of the stdio test, with no build step — verify: unit — `mcp/src/stdio.test.ts` initializes the real entry; the registration command in `mcp/README.md` is unchanged
- **NFR-4** [compatibility] stdout stays protocol-only: reading the version writes nothing to stdout — verify: unit — the existing stdio test's protocol exchange completes with no client error

## Module interactions

Packages: mcp
Surfaces: the MCP `initialize` response (`serverInfo`) of the DevDigest MCP server

| # | From → To | Channel | Carries | Exists today | If it fails |
|---|---|---|---|---|---|
| MI-1 | MCP client → mcp server | MCP `initialize` over stdio | `serverInfo.name`, `serverInfo.version` | changes (mcp/src/definitions.ts:3, mcp/src/server.ts:42) | the client is not answered; see EC-2 |
| MI-2 | mcp server → `mcp/package.json` | the package's own manifest, read when the server starts | the `version` string | new | the server does not start — EC-2, OQ-2 |

Contract — `serverInfo` in the `initialize` result:

- `name`: string — always `devdigest-mcp` (unchanged).
- `version`: string — exactly the `version` field of `mcp/package.json`, unmodified.

Nothing else in the `initialize` result changes: capabilities stay `tools` only and the
instructions stay `INSTRUCTIONS` (`mcp/src/server.test.ts:220-227`, `mcp/src/stdio.test.ts:42-43`).

## Design review

No design source was supplied. Code reviewed: IN-2, IN-3, IN-7, IN-8, IN-9, IN-10.

| # | Kind | Finding | Proposal | Decision |
|---|---|---|---|---|
| DR-1 | inconsistency | `mcp/src/server.test.ts:220-227` already asserts that the reported version equals `mcp/package.json`, and passes only because both read `0.0.0`; the check cannot see the hard-coded literal | make the check able to fail while the two values agree | open → OQ-1 |
| DR-2 | ux | the `server.ready` stderr line (`mcp/src/index.ts:25`) names the API URL and run budget but not the version, so a person reading the client's MCP log cannot tell which release started | add the version to that line | open → OQ-3 |

## Inputs and provenance

| # | Source | Kind | Used for |
|---|---|---|---|
| IN-1 | task text, 2026-10-17: «in the `mcp` package, SERVER_INFO.version is hard-coded as '0.0.0' (mcp/src/definitions.ts line 3); it must report the version from mcp/package.json instead (single source of truth, no second place to bump). … Note constraints: how the package is run (tsx/built?), tsconfig resolveJsonModule/rootDir, layering rules. The user is unavailable: do not ask questions; where you would ask, pick the recommended option and record it as an explicit assumption in the spec» | user text | Problem, G-1, G-2, US-1, US-2, AC-1, AC-3, AC-4, defaults of OQ-1…OQ-3 |
| IN-2 | mcp/src/definitions.ts @ 79a6886 | code | Problem, AC-2, MI-1 |
| IN-3 | mcp/src/server.ts @ 79a6886 | code | MI-1 |
| IN-4 | mcp/package.json @ 79a6886 | code | Problem, NG-1, NG-2, MI-2 |
| IN-5 | mcp/tsconfig.json @ 79a6886 | code | NG-2, NFR-2 |
| IN-6 | mcp/.dependency-cruiser.cjs @ 79a6886 | code | NFR-1 |
| IN-7 | mcp/src/server.test.ts @ 79a6886 | code | DR-1, NG-4, MI-1 contract |
| IN-8 | mcp/src/stdio.test.ts @ 79a6886 | code | AC-4, NFR-3, NFR-4, NG-4 |
| IN-9 | mcp/README.md @ 79a6886 (registration, line 35) | repository | EC-1, NG-2, NFR-3 |
| IN-10 | mcp/src/index.ts @ 79a6886 | code | EC-2, DR-2 |
| IN-11 | mcp/AGENTS.md, mcp/INSIGHTS.md, specs/devdigest-mcp-plan.md (decision 3) @ 79a6886 | repository | NG-3, NFR-4; no INSIGHTS entry bears on this feature |

| Items | Origin | Source |
|---|---|---|
| G-1, G-2, US-1, US-2, AC-1, AC-3, AC-4, EC-3 | stated | IN-1 |
| AC-2, NG-2, NG-3, NG-4, EC-1, NFR-1, NFR-2, NFR-3, NFR-4 | code | IN-2, IN-4…IN-11 |
| NG-1 | assumed | OQ-1 |
| EC-2 | assumed | OQ-2 |

## Untrusted inputs

None — the feature reads only `mcp/package.json`, a file of the package itself, and sends its
`version` to the client; no data from a pull request, a repository, a model or a user reaches it.

## Traceability

| Goal | Stories | Criteria | Edge cases | NFR |
|---|---|---|---|---|
| G-1 | US-1 | AC-1, AC-2, AC-4 | EC-1, EC-3 | NFR-3 |
| G-2 | US-2 | AC-3 | — | — |
| — | — | — | EC-2 | NFR-1, NFR-2, NFR-4 |

## Open questions

- **OQ-1** [non-blocking] How does the check prove the version is read from `mcp/package.json` while the hard-coded value and the manifest both read `0.0.0`? — options: a) keep `0.0.0` and add a check that fails when a version value other than the manifest's feeds `serverInfo` / b) bump `mcp/package.json` to a version other than `0.0.0` so the existing equality check discriminates / c) both — default taken: a (no version bump; user unavailable, recommended option recorded as assumption) — affects: NG-1, AC-3, DR-1
- **OQ-2** [non-blocking] What happens when `mcp/package.json` cannot be read or has no `version` string? — options: a) the server does not start, writing `server.startup_failed` to stderr and exiting with code 1, as other startup failures do / b) it starts and reports a fallback version — default taken: a (user unavailable, recommended option recorded as assumption) — affects: EC-2, MI-2
- **OQ-3** [non-blocking] Should the `server.ready` stderr line also carry the version (DR-2)? — options: a) not included / b) included — default taken: a (not included; user unavailable, recommended option recorded as assumption) — affects: DR-2
