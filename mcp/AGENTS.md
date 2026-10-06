# mcp — `@devdigest/mcp`

A local **MCP server over stdio**: a thin wrapper that lets a coding agent list
DevDigest's reviewer agents, run one on a pull request, re-read a run's findings and
read a repo's accepted conventions. It calls the DevDigest HTTP API and keeps no
database, model key or state of its own. npm, not pnpm. It is registered with the MCP
client and **never started by `./scripts/dev.sh` or `./scripts/e2e.sh`**.

## Commands

- `npm ci` — one-time install
- `npm test` — vitest, hermetic: fake API, in-memory MCP transport, and `stdio.test.ts`
  spawning the real entry against an unreachable port. No API, DB or key needed
- `npm run typecheck` — sources and tests (tests sit in `src/`)
- `npm run arch:check` — dependency-cruiser over the layer map below
- `npm start` — `tsx src/index.ts`, the stdio entry. The MCP client spawns it; you do
  not run it by hand (registration: `README.md`)

## Map

Layers, inside out; `.dependency-cruiser.cjs` holds the same map as rules.

- `src/text.ts`, `findings.ts`, `resolve.ts`, `constants.ts` — pure domain: clipping,
  result shaping, id/name resolvers over lists the use case already fetched. No I/O
- `src/ports.ts`, `errors.ts` — the `DevDigestApi` port with its camelCase slices;
  `ToolError`, `ApiError`
- `src/tools/` — use cases, one function per tool, the port passed in as an argument
- `src/api/` — driven adapter: `http-client.ts` (fetch) and `schemas.ts` (Zod slices
  of the server contracts); `src/log.ts` — stderr logger
- `src/definitions.ts`, `result.ts`, `server.ts` — the MCP surface; with `index.ts`,
  the only files that import the SDK
- `src/index.ts`, `config.ts` — composition root; `index.ts` is the only file that
  references `process.env` and hands it to `loadConfig(env)`
- `src/testing/fake-api.ts` — in-memory `DevDigestApi` for tests

## Read when

- Starting or registering the server, or looking up a tool's arguments and errors →
  `README.md`.
- Changing a tool's name, description, arguments or result → the contract is
  `../specs/devdigest-mcp-plan.md` Appendix A; change the text there first, then in
  `src/definitions.ts`.
- Adding a tool → add its row to `README.md` § Token audit.
- Working from the plan → `../specs/devdigest-mcp-plan.md`, before the first edit.
- Deciding where code belongs → `../.claude/skills/onion-architecture` (a design
  reference here; its enforced scope is `server/` and `reviewer-core/`).
- Something behaves inexplicably → `INSIGHTS.md` (§ What Doesn't Work, § Recurring Errors).
- You learned something non-obvious → append it to the matching `INSIGHTS.md` section.

## Conventions

- **stdout is protocol-only.** Logs go to stderr through `log.ts`; no `console.log`,
  no `process.stdout`.
- **Descriptions are a tested contract.** `definitions.ts` carries the texts of the
  plan's Appendix A.2 verbatim, and `server.test.ts` compares them with what
  `tools/list` returns. Schemas are flat scalars (no `$ref`, `$defs`, `anyOf`,
  `oneOf`), tools carry no `_meta`, and the serialized `tools` array and the
  instructions have size ceilings. Cross-tool facts live in the server instructions;
  argument formats live in the descriptions.
- **A new tool needs a token-audit entry** in `README.md`.
- **Errors lead onward.** Every `isError` result names the cause and the next step or
  tool to call; the texts are table A.4 of the plan.
- **Results are one compact JSON text block**, at most 20,000 chars, 10 findings by
  default. Text that comes from PRs or from the model is clipped and returned as data.
- **One write tool.** `run_agent_on_pr` is the only tool without `readOnlyHint: true`,
  and the HTTP adapter can issue only `POST /pulls/:id/review` and
  `POST /runs/:id/cancel` as non-GET calls. Annotations are hints; the limits are in code.
- **Nothing is imported from `server/`, `client/` or `vendor/shared`.** The wrapper
  declares its own narrow Zod slices and tolerates unknown severities.
- `process.env` is referenced in `index.ts` only; `config.ts` reads from the object it
  is given, and only `DEVDIGEST_API_URL` and
  `DEVDIGEST_MCP_RUN_TIMEOUT_MS`.

## Naming

- Files are kebab-case; a tool's file is its name in kebab-case
  (`run_agent_on_pr` → `tools/run-agent-on-pr.ts`).
- Wire JSON is snake_case, TS is camelCase. Wire slices are `Api*` in `src/api/schemas.ts`,
  port slices are `*Info` in `src/ports.ts`; a Zod schema and its inferred type share
  one PascalCase name.
- Tests are `*.test.ts` beside the code.

## Do not touch

- `package-lock.json` — npm here, not pnpm; never hand-edited.
- The pins on `@modelcontextprotocol/sdk` (exact) and `zod` — SDK 2.x needs Zod 4,
  which the rest of the repo does not run (root `INSIGHTS.md`).
- The description texts in `src/definitions.ts` without changing the plan first.
- `scripts/dev.sh` and `scripts/e2e.sh` — they must not start or mention this server.

## Gotchas

- **Never register `npm start`.** npm prints a `> pkg start` banner on stdout, which is
  the protocol channel. Register the `tsx` binary directly (command in `README.md`).
- **`run_agent_on_pr` spends money.** Every call starts a new paid LLM run. Tests use
  the fake API; read existing results with `get_findings`.
- **Running `server/`'s unit lane kills an in-flight review.** Its smoke test boots
  against the real dev DB and marks every `running` run failed. Run that lane with the
  isolated `DATABASE_URL` (`../server/INSIGHTS.md`), never while a review is waiting.
- **A stack started from an agent session dies with that session.** Start
  `./scripts/dev.sh` from your own terminal (root `INSIGHTS.md` § Recurring Errors).
