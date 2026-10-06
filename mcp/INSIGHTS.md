# Insights — mcp

Learnings for `@devdigest/mcp`: MCP SDK and client behaviour, the tool-surface size
budgets, and the DevDigest API facts the wrapper depends on.

**Fixed sections — append to the matching one, never to the bottom of the file.**
If an entry fits nowhere here, it probably belongs in `docs/` or nowhere at all.

How to write one: 1–3 lines, newest first inside its section, recording what a
careful reader could not have predicted from the code. Not a task log, not a
changelog, not a restatement of the diff. When an entry has bitten a third time,
promote it to `CLAUDE.md` — § Conventions for a pattern, § Gotchas for a trap —
and leave it here as history.

## What Works

Approaches and solutions that held up, with the context that made them work.

- **`claude -p "/context"` prints the full context table in print mode, and `--strict-mcp-config --mcp-config '<json>'` pins the MCP set for that one run — so the `devdigest` rows of README § Token audit need no interactive session and no change to the registration.** (2026-10-04, Claude Code 2.1.289) Measured from the repo root: no MCP servers 24.5k total; `devdigest` only 24.7k with `MCP tools (deferred) 1.6k` and `MCP server instructions 189`; the same with `ENABLE_TOOL_SEARCH=false` 41.9k — but `System tools` went 723 → 16.3k in that run, so the jump is the built-in tools un-deferring and the server's own share stays 1.6k (116–504 per tool).
  → Fill the audit from these three runs and read the `MCP tools` row, not the total. `/mcp` itself stays interactive (`claude mcp list` gives the connection status), and the GitHub MCP rows need `GITHUB_PERSONAL_ACCESS_TOKEN` exported first.

## What Doesn't Work

Dead ends and anti-patterns: what was tried, why it failed, what to do instead.
**The highest-value section and the one most often left empty. Fill it.**

- **dependency-cruiser leaves every `@modelcontextprotocol/sdk/...` import UNRESOLVED, so a rule written on `node_modules/@modelcontextprotocol` passes vacuously — the graph is green and the SDK boundary unchecked.** (2026-10-03) `npx depcruise src --output-type json` reported `couldNotResolve: true`, `dependencyTypes: ["unknown"]` and the bare specifier as `resolved`; the SDK maps `"./*"` to `{ types: "./dist/esm/*.d.ts", import: "./dist/esm/*" }` and enhanced-resolve takes the first key (`types`), appends `.d.ts` to `server/mcp.js` and finds nothing. `zod` resolved fine, which hides it.
  → `mcp/.dependency-cruiser.cjs` sets `options.enhancedResolveOptions.conditionNames` without `types` (resolves to `node_modules/@modelcontextprotocol/sdk/dist/esm/...`) and matches `(^|node_modules/)@modelcontextprotocol/`. After adding a rule on an npm package, list `resolved` for it in the JSON output and probe-import it once.

## Codebase Patterns

Conventions and architectural decisions found while working here, before they are
settled enough to move into `CLAUDE.md`.

- **The blast `totals` never equal the lengths of the lists beside them: `totals.symbols` counts every `changed_symbols` row, `downstream` holds only names with a caller outside the declaring file, and `totals.callers` counts unique `file#callerName` while the list shows call sites.** (2026-10-04) `server/src/modules/blast/helpers.ts:113-123`; live PR #7 gave 5 symbols / 4 groups and 18 callers / 21 `file:line` rows. `changed_symbols` can also repeat a name across files while `downstream` is keyed by name, so PR #2 was 70 symbols = 40 with callers + 26 in `no_callers` + repeats.
  → Do not assert `symbols.length + no_callers.length === totals.symbols`, and explain a "missing" symbol from `no_callers` before suspecting the index.

- **`GET /pulls/:id` never fails for a missing GitHub token: it logs a warning and serves the persisted detail, so the one-shot hydration in `get_blast_radius` is a silent no-op without a token.** (2026-10-03) `server/src/modules/pulls/service.ts:142-168` wraps `github()` and `getPullRequest` in one `try` and falls back to `listFiles(pr.id)` in the `catch`; the second `GET /pulls/:id/blast` then still reports `changed_files_count: 0`. Read from the source, not run against a live API.
  → Judge a hydration by the second map's `changedFiles`, never by `loadPullDetail` throwing; the "no stored files … needs a GitHub token in Settings" `next` text in `src/tools/get-blast-radius.ts` is the tokenless path.

## Tool & Library Notes

Quirks of dependencies, versions and tooling — what a library does that its docs
do not say.

- **`client.listTools()` entries from the in-memory transport carry `_meta` as an own key with value `undefined`, so `expect(tool).not.toHaveProperty("_meta")` fails although nothing is sent.** (2026-10-03) `mcp.js:126` builds `_meta: tool._meta` for every tool; `JSON.stringify` drops it, and over real stdio the key is absent.
  → Assert `tool._meta` is `undefined` and that `JSON.stringify(tools)` contains no `_meta` (`server.test.ts`, `stdio.test.ts`).

- **`registerTool` adds bytes to every `tools/list` entry that count against the 5,000-char budget, and the handler signature depends on `inputSchema`.** (2026-10-03) Probed with SDK 1.32.0: each tool carries `"execution":{"taskSupport":"forbidden"}`; `inputSchema: {}` serialises as `{"type":"object","properties":{},"$schema":"http://json-schema.org/draft-07/schema#"}` and any non-empty Zod shape adds `"additionalProperties":false` plus the same `$schema`; omitting `inputSchema` gives a bare `{"type":"object","properties":{}}`. With `inputSchema` (even `{}`) the callback is `(args, extra)`; without it, `(extra)` (`executeToolHandler` in `mcp.js`).
  → Measure `JSON.stringify((await client.listTools()).tools).length` from a real in-memory client rather than summing descriptions, and for the zero-argument tool pick one form on purpose and match the callback to it.

- **MCP SDK 1.32.0 never raises a protocol error for a tool call: a schema-validation failure and ANY error thrown by a handler both come back as `isError: true`, carrying the raw `error.message`.** (2026-10-03) `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:140-182` catches everything except `UrlElicitationRequired`. Probed in memory: a call missing `pr` returned `MCP error -32602: Input validation error: Invalid arguments for tool flat: Required at pr`, an unknown tool `MCP error -32602: Tool nope not found`, and a handler that threw `boom` returned just `boom`. Unknown argument keys are silently stripped, not rejected.
  → Catch inside every handler (`toToolResult`) so no internal message leaks verbatim, and assert bad arguments in `server.test.ts` as an `isError` result naming the field, not as a rejected promise.

## Recurring Errors & Fixes

Error or symptom → cause → fix, one entry each, so the next occurrence is a lookup
instead of an investigation.

_None yet._

## Session Notes

Dated summaries as `### YYYY-MM-DD — topic`: what was worked on and what state it
was left in. Prune an entry once its content has moved into a section above.

_None yet._

## Open Questions

Unresolved behaviour, undecided design, unverified assumptions. Delete an entry when
it is answered — the answer belongs in another section.

_None yet._
