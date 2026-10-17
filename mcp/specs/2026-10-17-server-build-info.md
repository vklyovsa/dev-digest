# Spec: MCP server version from package.json — build info
Spec ID: SPEC-12
Status: draft
Supersedes: none

## Problem and user

A coding agent (and the person behind it) that connects to the DevDigest MCP server learns the
server's identity from the `serverInfo` of the MCP `initialize` response. Today that version is
the literal `'0.0.0'` written in the server's sources (`mcp/src/definitions.ts:3`), independent
of the `version` field of `mcp/package.json` (`mcp/package.json:3`). The two only agree by
coincidence: a maintainer who bumps `mcp/package.json` has to remember a second place, and when
they forget, every client is told a version that is not the one running. Known from the task
text (IN-1) and the code (IN-2, IN-4).

An operator who runs the server also cannot tell two running copies of the same version apart:
nothing the server reports today names the build it runs from, and the package has no build step
(NG-2). This need stands in the draft as found (IN-14) with no source behind it
[NEEDS CLARIFICATION: whether this was asked for, and what identifies a build → OQ-4].

The first two paragraphs repeat SPEC-11 (`mcp/specs/2026-10-17-server-version-from-package-json.md`,
`Status: approved`, IN-12), whose implementation is already in the working tree (IN-13)
[NEEDS CLARIFICATION: whether this spec replaces SPEC-11 or only adds the build identity to it → OQ-5].

## Goals / Non-goals

- **G-1** A client that connects to the MCP server is told, in `serverInfo.version`, the version that `mcp/package.json` declares.
- **G-2** The server version is declared in one place: changing the `version` field of `mcp/package.json` is the only edit needed for the server to report a new version.
- **G-3** An operator can tell which build of the server is running [NEEDS CLARIFICATION: what identifies a build, and where it is shown → OQ-4].
- **NG-1** Changing the version number itself (it stays `0.0.0` in `mcp/package.json`) — not asked for [NEEDS CLARIFICATION: whether to bump it so the existing equality check can tell the two sources apart → OQ-1].
- **NG-2** A build step or emitted output for the package — the server runs from source through `tsx` (`mcp/package.json:8`, `mcp/README.md:35`, `mcp/tsconfig.json` has `noEmit: true`), and this feature keeps it so.
- **NG-3** Changing `serverInfo.name` — it stays `devdigest-mcp` (decision 3 of `specs/devdigest-mcp-plan.md`).
- **NG-4** The version a test client announces about itself (`mcp/src/server.test.ts:72`, `mcp/src/stdio.test.ts:36`) — that is the client's identity, not the server's.

## User stories

- **US-1** As a coding agent connected to the DevDigest MCP server, I want the `initialize` response to carry the package's real version, so that the person debugging a session can tell which release of the server answered.
- **US-2** As a maintainer of the `mcp` package, I want to bump the version only in `mcp/package.json`, so that the reported version cannot drift from the declared one.
- **US-3** As an operator running the MCP server, I want it to report which build it is, so that I can tell two deployments of the same version apart. [NEEDS CLARIFICATION: no source states this story; what a build and a deployment are for a server that runs from source → OQ-4]

## Acceptance criteria (EARS)

- **AC-1** [event-driven] WHEN an MCP client completes the `initialize` handshake, the MCP server shall report `serverInfo.version` equal to the `version` field of `mcp/package.json`. — covers: US-1 · verify: unit — an in-memory client's `getServerVersion().version` equals the `version` read from `mcp/package.json` in the same test
- **AC-2** [event-driven] WHEN an MCP client completes the `initialize` handshake, the MCP server shall report `serverInfo.name` as `devdigest-mcp`. — covers: US-1 · verify: unit — an in-memory client's `getServerVersion().name` is `devdigest-mcp`
- **AC-3** [ubiquitous] The MCP server shall take `serverInfo.version` from the `version` field of `mcp/package.json` and from no version value written anywhere else in the package. — covers: US-2 · verify: unit — the check fails when the reported version comes from a value other than `mcp/package.json`, even while that value and `mcp/package.json` both read `0.0.0` [NEEDS CLARIFICATION: how the check tells a value read from mcp/package.json from a matching literal → OQ-1]
- **AC-4** [event-driven] WHEN the real stdio entry is started from a working directory other than `mcp/`, the MCP server shall report `serverInfo.version` equal to the `version` field of `mcp/package.json`. — covers: US-1 · verify: unit — the stdio test spawns the entry with a working directory outside `mcp/` and compares `getServerVersion().version` with `mcp/package.json`
- **AC-5** [event-driven] WHEN the MCP server starts, the MCP server shall report [NEEDS CLARIFICATION: which build identifier — e.g. a commit of the checkout, a start time, an operator-set value → OQ-4] in [NEEDS CLARIFICATION: which surface — a `serverInfo` field, a suffix of `serverInfo.version`, or the `server.ready` stderr line → OQ-4]. — covers: US-3 · verify: unit — [NEEDS CLARIFICATION: what the check observes depends on the surface chosen → OQ-4]

## Edge cases

- **EC-1** The MCP client starts the server from its own working directory — the registered command (`mcp/README.md:35`) names `tsx` and `src/index.ts` by absolute path and sets no working directory → the reported version is still the one in `mcp/package.json` — covered by: AC-4
- **EC-2** `mcp/package.json` cannot be read, or has no `version` string → the server does not start: it writes one `server.startup_failed` line to stderr and exits with code 1, the existing startup-failure path (`mcp/src/index.ts:28-32`) [NEEDS CLARIFICATION: fail at startup or report a fallback version → OQ-2] — open: OQ-2
- **EC-3** The version carries a pre-release or build suffix (`1.2.0-rc.1`, `1.2.0+abc`) → it is reported character for character as `mcp/package.json` holds it — covered by: AC-1
- **EC-4** The build identifier cannot be determined when the server starts (for example the source it names is missing or unreadable) → [NEEDS CLARIFICATION: fail at startup, report a placeholder, or omit it — depends on what identifies a build → OQ-4] — open: OQ-4

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
| MI-2 | mcp server → `mcp/package.json` | the package's own manifest, read when the server starts | the `version` string | new at 79a6886; written in the uncommitted working tree (IN-13: `mcp/src/index.ts` reads `../package.json` and hands the version to `createServer`) | the server does not start — EC-2, OQ-2 |
| MI-3 | mcp server → [NEEDS CLARIFICATION: source of the build identifier → OQ-4] | [NEEDS CLARIFICATION: channel → OQ-4] | the build identifier | new | see EC-4, OQ-4 |
| MI-4 | mcp server → MCP client or operator | [NEEDS CLARIFICATION: `initialize` `serverInfo`, or the `server.ready` stderr line → OQ-4] | the build identifier | new | see EC-4, OQ-4 |

Contract — `serverInfo` in the `initialize` result:

- `name`: string — always `devdigest-mcp` (unchanged).
- `version`: string — exactly the `version` field of `mcp/package.json`, unmodified.

Nothing else in the `initialize` result changes: capabilities stay `tools` only and the
instructions stay `INSTRUCTIONS` (`mcp/src/server.test.ts:220-227`, `mcp/src/stdio.test.ts:42-43`).
Where the build identifier of US-3 is carried is not decided
[NEEDS CLARIFICATION: a `serverInfo` field other than `version`, a build suffix on `version` (which would change AC-1 and EC-3), or stderr only → OQ-4].

## Design review

No design source was supplied. Code reviewed: IN-2, IN-3, IN-7, IN-8, IN-9, IN-10, IN-12, IN-13.

| # | Kind | Finding | Proposal | Decision |
|---|---|---|---|---|
| DR-1 | inconsistency | `mcp/src/server.test.ts:220-227` already asserts that the reported version equals `mcp/package.json`, and passes only because both read `0.0.0`; the check cannot see the hard-coded literal | make the check able to fail while the two values agree | open → OQ-1 |
| DR-2 | ux | the `server.ready` stderr line (`mcp/src/index.ts:25`) names the API URL and run budget but not the version, so a person reading the client's MCP log cannot tell which release started | add the version to that line | open → OQ-3 |
| DR-3 | inconsistency | G-1, G-2, US-1, US-2, AC-1…AC-4, EC-1…EC-3 and NFR-1…NFR-4 repeat SPEC-11 word for word under the same IDs (IN-12), SPEC-11 is `approved`, and its implementation is already in the working tree (IN-13); this spec's header says `Supersedes: none` | either supersede SPEC-11, or keep only the build-identity part here | open → OQ-5 |
| DR-4 | inconsistency | US-3 asks for "which build" while NG-2 keeps the package without a build step (`mcp/tsconfig.json` `noEmit: true`, `tsx` on `src/index.ts`); nothing in `mcp/src` names a build, commit or start time today | decide what a build is before a criterion is written | open → OQ-4 |

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
| IN-12 | mcp/specs/2026-10-17-server-version-from-package-json.md (SPEC-11, `Status: approved`) and its `-plan.md`; mcp/specs/README.md § Open specs | repository | Problem, DR-3, OQ-5 |
| IN-13 | uncommitted working tree of mcp/src against 79a6886 (`config.ts` `parseServerVersion`, `index.ts` reads `../package.json`, `server.ts` takes `version`, `definitions.ts` `SERVER_NAME`, tests in `server.test.ts` and `stdio.test.ts`) | code | Problem, MI-2, DR-3 |
| IN-14 | this draft as found, 2026-10-17 — title "build info" and US-3, with no source in its provenance | repository | US-3, G-3, DR-4, OQ-4 |
| IN-15 | task text, 2026-10-17: «Finish the existing draft spec at mcp/specs/2026-10-17-server-build-info.md … keep what the draft already decides, fill the missing sections in the template's shape with EARS acceptance criteria … mark every unresolved point as <the clarification marker> … Do not guess requirements.» | user text | AC-5, EC-4, MI-3, MI-4, OQ-4, OQ-5 |

The words in IN-1 «do not ask questions; where you would ask, pick the recommended option» are
an instruction from an earlier task; they shaped the defaults of OQ-1…OQ-3 and are not applied to
OQ-4 or OQ-5, which have no default.

| Items | Origin | Source |
|---|---|---|
| G-1, G-2, US-1, US-2, AC-1, AC-3, AC-4, EC-3 | stated | IN-1 |
| AC-2, NG-2, NG-3, NG-4, EC-1, NFR-1, NFR-2, NFR-3, NFR-4 | code | IN-2, IN-4…IN-11 |
| NG-1 | assumed | OQ-1 |
| EC-2 | assumed | OQ-2 |
| G-3, US-3, AC-5, EC-4 | assumed | OQ-4 |

## Untrusted inputs

None — the feature reads only `mcp/package.json`, a file of the package itself, and sends its
`version` to the client; no data from a pull request, a repository, a model or a user reaches it.

## Traceability

| Goal | Stories | Criteria | Edge cases | NFR |
|---|---|---|---|---|
| G-1 | US-1 | AC-1, AC-2, AC-4 | EC-1, EC-3 | NFR-3 |
| G-2 | US-2 | AC-3 | — | — |
| G-3 | US-3 | AC-5 | EC-4 | — |
| — | — | — | EC-2 | NFR-1, NFR-2, NFR-4 |

## Open questions

- **OQ-1** [non-blocking] How does the check prove the version is read from `mcp/package.json` while the hard-coded value and the manifest both read `0.0.0`? — options: a) keep `0.0.0` and add a check that fails when a version value other than the manifest's feeds `serverInfo` / b) bump `mcp/package.json` to a version other than `0.0.0` so the existing equality check discriminates / c) both — default taken: a (no version bump; user unavailable, recommended option recorded as assumption) — affects: NG-1, AC-3, DR-1
- **OQ-2** [non-blocking] What happens when `mcp/package.json` cannot be read or has no `version` string? — options: a) the server does not start, writing `server.startup_failed` to stderr and exiting with code 1, as other startup failures do / b) it starts and reports a fallback version — default taken: a (user unavailable, recommended option recorded as assumption) — affects: EC-2, MI-2
- **OQ-3** [non-blocking] Should the `server.ready` stderr line also carry the version (DR-2)? — options: a) not included / b) included — default taken: a (not included; user unavailable, recommended option recorded as assumption) — affects: DR-2
- **OQ-4** [blocking] Was US-3 asked for, and if so what identifies a "build" of a server that runs from source, and where is it shown? — options: a) the short commit of the checkout the server runs from, in the `server.ready` stderr line only (`serverInfo` unchanged; merges with OQ-3) / b) the same commit carried in `serverInfo` — as a separate field, or as a `+<commit>` suffix on `version`, which changes AC-1 and EC-3 / c) an operator-set value from the environment, in the `server.ready` line / d) drop US-3 and G-3 — what `serverInfo` can carry besides `version` goes to `researcher` (R1) — affects: G-3, US-3, AC-5, EC-4, MI-3, MI-4, DR-4
- **OQ-5** [blocking] How does this spec relate to SPEC-11, which is approved and already being implemented with the same G-1…NFR-4? — options: a) keep only the build identity here (G-3, US-3, AC-5, EC-4, MI-3, MI-4) and refer to SPEC-11 for the rest; `Supersedes: none` / b) supersede SPEC-11: `Supersedes: SPEC-11 (mcp/specs/2026-10-17-server-version-from-package-json.md)` and its index entry marked superseded / c) no new spec — US-3 is dropped and this draft is deleted by the user — affects: Problem, DR-3, every item shared with SPEC-11
