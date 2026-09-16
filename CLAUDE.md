# DevDigest — repository map

Local-first AI pull-request review. **Four standalone packages, not a workspace**:
each has its own `package.json` and lockfile; code is shared through tsconfig path
aliases, never through published modules.

| Folder | Package | What it is | Port |
|---|---|---|---|
| `server/` | `@devdigest/api` | Fastify 5 + Drizzle ORM / Postgres (pgvector) | 3001 |
| `client/` | `@devdigest/web` | Next.js 15 App Router + React 19 | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | pure engine: diff → prompt → LLM → findings | — |
| `e2e/` | `@devdigest/e2e` | deterministic browser e2e (agent-browser) | — |

Node >= 22. **`server/` and `client/` use pnpm; `reviewer-core/` and `e2e/` use npm.**
Only Postgres runs in Docker — the API and the web app run on the host.

## Commands

- Whole stack: `./scripts/dev.sh` (Postgres + API :3001 + web :3000, seeded)
- Migrations: `cd server && pnpm db:migrate` — **never applied on boot**
- Browser e2e: `./scripts/e2e.sh` — isolated stack on alternate ports
- Per-package test / typecheck commands: see that package's `CLAUDE.md`

## Read when

- Starting work inside a package → read its `CLAUDE.md` first (`server/`, `client/`,
  `reviewer-core/`, `e2e/`). Per-directory autoload is unreliable in some editors,
  so open it explicitly rather than assuming it loaded.
- You need the end-to-end picture or the architecture diagrams → `README.md`.
- Anything about test suites, the unit/integration split, or CI lanes → `TESTING.md`.
- Writing or editing a reviewer agent's system prompt → `docs/agent-prompts/`.
- The task comes from a written spec or a course lesson → `specs/`.
- Tooling or the environment behaves inexplicably → `INSIGHTS.md` (§ Recurring Errors).
- You learned something non-obvious → append it to the matching `INSIGHTS.md` section.
- Domain rules (Fastify, Drizzle, Postgres, Zod, React, Next, security) live in
  `.claude/skills/` and load on demand — do not restate them anywhere else.

## Session protocol

- **Before the first edit** in a package → read its `INSIGHTS.md` in full and say which
  entries bear on the task, or that none do. Root `INSIGHTS.md` when no package is named.
- **When a surprise resolves, and before reporting a task complete** → run the
  `engineering-insights` skill. It re-reads the file, skips what is already recorded, and
  appends; it never rewrites. Having nothing substantial to add is the normal outcome.

## Conventions

- Cross-package imports go through tsconfig path aliases, so editing
  `reviewer-core/src` breaks the server typecheck and triggers the server CI lane.
- `@devdigest/shared` (Zod contracts) exists as **two copies**:
  `server/src/vendor/shared` and `client/src/vendor/shared`. `reviewer-core`
  type-checks against the server copy. A contract change must land in both.
- CI is path-filtered per package: `.github/workflows/<package>.yml`.
- Course lessons add features as self-contained modules; the DB schema already
  contains every table, the unused ones simply sit empty.

## Do not touch

- `server/clones/**` — runtime data (git-ignored): checkouts of imported repos.
- `server/package.json` — marked `skip-worktree`; the local copy diverges from the
  committed one, which is why CI invokes vitest directly instead of via scripts.

## Gotchas

- **Never `docker compose down -v`** — the volume holds every imported repo and
  every review anyone has run locally.
- `relation ... does not exist` means migrations were not applied, not a code bug.
- Port 5432 already in use means another Postgres is running; nothing falls back.
