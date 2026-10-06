# Blast Radius — what else a PR's diff can affect

L04 homework. Packages: **server**, **client**, **mcp** (`reviewer-core/` and `e2e/`
untouched). Acceptance criteria with ids (`P1.1` … `P3.7`):
[`blast-radius-acceptance.md`](blast-radius-acceptance.md). Decisions taken without the
user: [`blast-radius-questions.md`](blast-radius-questions.md). Design reference:
`i/img_2.png` … `i/img_6.png` (tree view, graph view, prior PRs).

## Goal

A reviewer opens a pull request and sees, on the Overview tab, a **Blast radius** block
answering "what else can this diff touch?":

- which symbols are declared in the changed files;
- who imports or calls those symbols (`file:line`, a link to that line on GitHub);
- which HTTP endpoints and crons may depend on the changed code.

The same map is available to a coding agent through the `get_blast_radius` MCP tool.

The data is **already computed**: `repo-intel` built the index when the repo was cloned.
The feature reads it and shows it. It never parses the repository again and never calls a
model.

## Non-goals

- No LLM call anywhere (no generated summary, no generated notes on prior PRs).
- No new index, table, migration or background job; no re-parse of the clone on the
  indexed path.
- No transitive (multi-hop) caller traversal: the facade returns direct callers only.
- No change to `reviewer-core/`, to the review prompt, or to e2e flows.
- No lockfile / dependency change (the graph is hand-rolled SVG).

## Behaviour

### B1. Route — `GET /pulls/:id/blast` (new module `server/src/modules/blast/`)

1. Resolves the PR in the caller's workspace (404 `Pull request not found` otherwise),
   reads its stored changed files, calls `repoIntel.getBlastRadius(repoId, changedFiles)`
   **exactly once**, and maps `BlastResult` → the `BlastRadius` contract.
2. Mapping (a pure function, unit-tested):
   - `changed_symbols` ← `changedSymbols`.
   - `downstream` ← the flat `callers` grouped by `viaSymbol`: one entry per changed
     symbol that has at least one caller; `callers[]` = `{ name: symbol, file, line }`
     ordered by `rank` desc; groups ordered by their best caller `rank` desc, then by
     caller count desc, then by name (P3.5).
   - `endpoints_affected` / `crons_affected` for a group ← `factsByFile` of that group's
     caller files, de-duplicated, crons kept apart from endpoints (P3.4). Facts of
     **test files** are not attributed (a test that calls an endpoint does not serve it).
   - `summary` ← a sentence built from the four numbers, no model.
3. The response is a superset of `BlastRadius` (so `BlastRadius.parse(response)` holds,
   P2.2) that also carries:
   - `totals` — symbols, callers, endpoints, crons (the summary line);
   - `degraded` + `reason` — the facade's values passed through unchanged (P2.7); in
     addition, when the facade served the map from an index whose state is `partial`,
     `degraded: true, reason: 'index_partial'`;
   - the per-symbol caller cap, read from `repo-intel/constants.ts`
     (`MAX_CALLERS_PER_SYMBOL`), so the UI never hardcodes it (P2.6);
   - the commit the index was built at (so `file:line` links point at the exact line);
   - how many changed files the map was computed from (0 = the PR's files were never
     stored);
   - what the graph view needs to draw caller → endpoint/cron edges (per-caller-file
     facts).
4. One `info` log line per request names the source (persisted index vs fallback), the
   index status, the counts and the duration (P2.1).
5. The facade never throws; neither does the route for missing data — an empty map with
   `degraded`/`reason` is a 200.

### B2. Facade corrections (`server/src/modules/repo-intel/service.ts`)

Three places where the facade does not do what its own contract says:

- `MAX_CALLERS_PER_SYMBOL` is documented as a **per-symbol** cap but is applied as
  `callers.slice(0, 20)` to the whole flat list, so a PR touching several popular symbols
  loses every caller of the lower-ranked ones. Apply the cap per `viaSymbol` (rank desc),
  on both the persistent and the fallback path.
- The fallback (degraded) path already reads every caller file and extracts its endpoints,
  but returns only the flat union. Also return `factsByFile` (endpoints + crons per caller
  file) there, so a degraded map is attributed the same way as an indexed one.
- With indexing switched off (`REPO_INTEL_ENABLED=false`) the fallback reports `no_data`;
  `getRepoMap` and `getConventionFacts` already say `flag_off` in that case. Report
  `flag_off` here too.

### B3. Prior PRs — `GET /pulls/:id/blast/history` (P3.3)

- Returns `PrHistory` (contract exists): merged PRs of the same repo, other than this one,
  that changed at least one of the same files — newest first, capped by a constant.
  `files_overlap` = the shared paths; `notes` = a deterministic sentence (no model).
- Source: GitHub, through the existing `GitHubClient` port (a new method on the port +
  Octokit adapter + mock). One round trip where the API allows it.
- A separate route on purpose: the map itself stays index-only and offline. No token /
  GitHub down → 200 with an empty list and a flag the UI can explain; it never breaks the
  map.

### B4. Overview block (client)

- `BlastRadiusCard` on the Overview tab, next to the Intent card (two columns on a wide
  screen, stacked on a narrow one — as in the design), data from a new hook
  `client/src/lib/hooks/blast.ts`.
- **Summary line** (P1.2): `N symbols · N callers · N endpoints · N cron/jobs`.
- **Tree view** (P1.3, P3.1): one collapsible row per changed symbol with its caller
  count; expanded → callers as `file:line` links, then endpoint chips, then cron chips in
  a visually distinct style (P3.4). The first symbol starts expanded.
- **Links** (P1.5): `githubBlobUrl(repoFullName, sha, file, line)`, new tab; `sha` = the
  indexed commit when known, else the PR head.
- **Graph view** (P3.2): `Tree | Graph` switch; SVG, three columns — changed symbols →
  callers → endpoints/crons — with a legend; empty text from `graph.empty`.
- **States** (P1.6):
  - loading skeleton; request error with retry;
  - changed symbols but no callers → `noDownstream`;
  - nothing indexed in the changed files → its own sentence;
  - `degraded` → a separate badge with the reason in words, plus a **Re-index** button
    calling `POST /repos/:id/resync` (P3.6) and refreshing the map when the index
    advances. A degraded map with data still shows the data.
- When a symbol's caller list reached the cap, a note says the top N by rank are shown
  (N from the response).
- **Prior PRs touching these files** (P3.3): a collapsible section with the count; each
  item links to the PR on GitHub and shows author, merge date and the shared files.
- Every label comes from `client/messages/en/blast.json` (P3.7).

### B5. MCP tool — `get_blast_radius` (mcp)

- Replaces the stub: resolves `repo` + `pr` like the other tools, calls
  `GET /pulls/:id/blast`, returns a compact JSON text block — summary, totals,
  `degraded`/`reason`, and per symbol its callers as `file:line`, endpoints and crons.
  Caps and `truncated` follow the conventions of the existing tools.
- If the map was computed from zero stored files, the tool loads the PR detail once (which
  stores the files) and asks for the map again.
- Unknown repo / PR → the same actionable errors the other tools return. `readOnlyHint:
  true`. Description says what it returns and when to call it; the `tools/list` and
  instructions size ceilings still hold; `specs/devdigest-mcp-plan.md` Appendix A and
  `mcp/README.md` (tool table, token audit) are updated first, as `mcp/AGENTS.md` requires.

## Affected packages and files

- **server** — new `src/modules/blast/` (routes, service, helpers, constants, types),
  registry + container wiring, `repo-intel/service.ts` (B2), `GitHubClient` port +
  Octokit adapter + mock (B3), `vendor/shared` contract (response schema).
- **client** — the same contract change in `client/src/vendor/shared`, hook
  `lib/hooks/blast.ts`, `OverviewTab` + new `BlastRadiusCard`, `messages/en/blast.json`,
  the PR page passing repo/PR context down.
- **mcp** — `tools/get-blast-radius.ts`, `definitions.ts`, `ports.ts`, `api/`,
  `server.ts`, `testing/fake-api.ts`, README, plan Appendix A.

## Test PR for the demo

Needs a PR that changes an exported function imported by ≥ 2 other files, with at least
one importer that declares routes. In the index of `vklyovsa/dev-digest` the best
candidates are `server/src/modules/_shared/context.ts` (`getContext`: 8 caller files, 7
of them route files) and `server/src/modules/pulls/status.ts` (2 caller files, 1 route
file).
