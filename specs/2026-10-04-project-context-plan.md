# Implementation Plan — Project Context
Source: `specs/2026-10-04-project-context.md` (SPEC-01, `Status: approved`, `check-spec.sh` ok with two WARNs) · Base: `905cd86` · Packages: server, client, reviewer-core

All paths are relative to `/home/klov/emdash/repositories/dev-digest`. Spec pointers: `spec:N` is line N of the source; AC-n is at line 68+n, NFR-n at 199+n, EC-n at 163+n.

## 0. Before the first edit
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "An implementer's token bill is turns × standing context" → nine briefs of one or two stages, each stage with a `Read first` list.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "Proving absence with `git grep` passes vacuously for a new, still-untracked module" → every absence check in §6 uses `grep -rn`.
- INSIGHTS: `INSIGHTS.md § What Doesn't Work` — "pr-self-review runs no drizzle/postgres lane on a table edit" → Stage 3 applies `drizzle-orm-patterns` and `postgresql-table-design` deliberately.
- INSIGHTS: `INSIGHTS.md § Codebase Patterns` — "The starter pre-wires a course lesson on both sides" → extend `SpecFile`, `useContextFiles`, `client/messages/en/context.json` and the `/context` key. No second contract or namespace (NFR-10).
- INSIGHTS: `INSIGHTS.md § Codebase Patterns` — "A consumer-declared structural port is what actually breaks a module/composition-root cycle" → `ContextDeps` in the new module, `ProjectContextResolver` in `reviews/deps.ts`.
- INSIGHTS: `INSIGHTS.md § What Works` — "Any write to the dev DB goes through a dry run on a restored copy" → Stage 3 only generates the migration. The user applies it with `cd server && pnpm db:migrate`; nothing is seeded.
- INSIGHTS: `INSIGHTS.md § What Works` — "To prove a screen made no model call, diff `agent_runs` / `run_traces`" → the NFR-1 assertions in Stages 5 and 6.
- INSIGHTS: `INSIGHTS.md § Tool & Library Notes` — "pnpm 12.4.2 exits non-zero with `ERR_PNPM_IGNORED_BUILDS` AFTER doing the work" → judge `db:generate` by the files it wrote; fall back to `./node_modules/.bin/drizzle-kit generate`.
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes` — "`drizzle-kit generate` becomes INTERACTIVE the moment one migration both drops and adds columns" → Stage 3 adds two tables and alters nothing.
- INSIGHTS: `server/INSIGHTS.md § Tool & Library Notes` — "`pnpm typecheck` does not look at `test/**`" → the two server tests that pass `specs: [string]` break at run time only; Stage 2 updates them.
- INSIGHTS: `server/INSIGHTS.md § Recurring Errors` — "`now()` hardcodes the NAME" → the new tables carry no timestamp column.
- INSIGHTS: `server/INSIGHTS.md § Codebase Patterns` — "A derived count belongs on the DTO, filled by one grouped IN-query" → `agent_count` comes from two queries for the whole list, never one per document.
- INSIGHTS: `server/INSIGHTS.md § Codebase Patterns` — "A studio review is ONE LLM call, whatever the test name says" → AC-70 is proven in `reviewer-core/test`, not through the server.
- INSIGHTS: `server/INSIGHTS.md § Open Questions` — "`reviews-skills.it.test.ts` … failed once in the full `.it` lane" → the new run test waits with `waitForPrRuns` before reading the trace; re-run the file alone before blaming a change.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors` — "The client's vendored `@devdigest/shared` is a TYPE-only dependency" → `import type` only in every new client file.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "A bare ICU argument does not group digits" → every count is `{x, number}` (NFR-7).
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors` — "A vitest hook that RETURNS a function…" and "`Unable to find an element with the text`" → block-bodied hooks; assert the joined text of a multi-node element.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "A vitest path filter under a Next.js dynamic segment silently matches nothing" → filter by a name fragment.
- INSIGHTS: `client/INSIGHTS.md § Tool & Library Notes` — "`Chip` always renders a `<button>`" and "`MonoLink` renders a `<button>` when it is given no `href`" → read-only rows are plain spans.
- INSIGHTS: `client/INSIGHTS.md § Recurring Errors` — "The PR page renders blank … right after `pnpm build`" → no `next build` in this plan.
- INSIGHTS: `client/INSIGHTS.md § Open Questions` — "`<Markdown>` headings and lists probably render as plain body text" → Stage 7 adds the styles; AC-14 stays a manual check.
- INSIGHTS: `client/INSIGHTS.md § Open Questions` — "whether a shared `src/components/*` component forces every test … to register the `common` namespace" → tests that render `RepoNotFound` pass `common`.
- INSIGHTS: `reviewer-core/INSIGHTS.md` — none bear.
- Read: the spec (Module interactions and Contracts `spec:214-333`, Untrusted inputs `spec:420-429`); `server/docs/intent-in-prompt.md`, `server/docs/skills-in-prompt.md`, `server/docs/prompt-logging.md`; `client/docs/skills-ui.md`; frames `i/img.png`, `i/img_1.png`, `i/img_2.png`, `i/img_3.png` for Stages 8, 10, 11, 12.
- Dirty before this plan and not part of it — never edit or revert: `.claude/**`, root `AGENTS.md` / `TESTING.md`, `mcp/AGENTS.md`, the `specs/README.md` files, `server/vitest.config.ts`, `server/test/hermetic-env.test.ts`. `INSIGHTS.md` files are dirty too and are append-only.

## 1. Scope — as the source states it
Goal:
- G-1 "A reviewer finds, on one Project Context page, every Markdown document under the active repository's `specs`, `docs` and `insights` folders and reads it rendered." — `spec:33`
- G-2 "An agent author attaches documents to an agent by hand, in a chosen order, and sees the token estimate they add to each prompt." — `spec:34`
- G-3 "An agent author attaches documents to a skill, and every agent that uses the skill receives them." — `spec:35`
- G-4 "A review run reads the attached documents from the repository when it starts and sends them to the model as untrusted data in one `## Project context` section, without an extra model call." — `spec:36`
- G-5 "A run's trace shows which documents were read, the token estimate of each, and the full text that was sent." — `spec:37`

Non-goals (`spec:38-47`):
- NG-1 "Automatic selection of documents from a pull request's content"
- NG-2 "Creating, editing, uploading or deleting documents or folders from the product"
- NG-3 "`.devdigest/specs/` or any other dot-directory as a place where documents are found"
- NG-4 "A chunk or embedding index of documents (… the pre-wired `IndexStatus` contract and the hook for `POST /repos/:id/context/reindex`)"
- NG-5 "The COVERAGE ring of the page frame"
- NG-6 "Storing document text with an agent or a skill"
- NG-7 "Writing the path list or document text into the trusted `## Skills / rules` section or into a skill's body, or changing a skill's version on attach"
- NG-8 "Changes to the MCP tools"
- NG-9 "The other differences between the trace frame and today's drawer"
- NG-10 "Attaching a document to agents or skills from the Project Context page itself"

Acceptance criteria (cut wording; the full text and its `verify:` clause are at `spec:68+n`; unmarked lines are `clear`):
- AC-1 "return one entry for every `.md` file that lies under a folder named as a configured root, at any depth" — `:69`
- AC-2 "take its search roots from server configuration and search `**/{specs,docs,insights}/**/*.md` when none is configured" — `:70`
- AC-3 "leave out … every file that lies inside a directory whose name starts with a dot" — `:71`
- AC-4 "set each document's `type` to the name of the root folder that comes first in its path" — `:72`
- AC-5 "order the document list by `type` in the order the roots are configured and then by `path`" — `:73`
- AC-6 "return that document's `path`, `type`, `tokens` and full `content`" — `:74`
- AC-7 "IF the `path` … is not in the repository's document list, THEN … 404 and return no file content" — `:75`
- AC-8 "IF the repository has no clone on disk, THEN … 200 and an empty `documents` array" — `:76`
- AC-9 "IF the repository, agent or skill … does not belong to the caller's workspace, THEN … 404" — `:77`
- AC-10 "a Project Context item in the WORKSPACE group that links to `/repos/:repoId/context`" — `:78` — active key and palette label already there (`client/src/components/app-shell/helpers.ts:30`, `client/messages/en/shell.json:20`); the item is missing
- AC-11 "list every document the API returned with its file name, its folder and its type badge" — `:79`
- AC-12 "show only the documents whose path contains the typed text, ignoring letter case" — `:80`
- AC-13 "content rendered as Markdown, with headings as heading elements and list items as list elements" — `:81`
- AC-14 "headings in a larger font than its body text and its list items with bullet markers" — `:82` — manual
- AC-15 "show the number of agents that use it, taken from the document's `agent_count`" — `:83`
- AC-16 "the number of agents in the workspace that have its path attached directly or through a linked, enabled skill" — `:84`
- AC-17 "WHEN the reviewer activates the refresh control, … send `POST /repos/:id/resync`" — `:85`
- AC-18 "show the number of documents found" — `:86`
- AC-19 "offer no control that creates, edits, uploads or deletes a document or a folder" — `:87`
- AC-20 "WHILE the document list is loading, … a loading placeholder in place of the list" — `:88`
- AC-21 "IF the document list is empty, THEN … an empty state that names the folders being searched" — `:89`
- AC-22 "IF the document list request fails, THEN … an error message with a control that repeats the request" — `:90`
- AC-23 "IF the repository id in the URL matches no repository, THEN … the no-repository empty state that the other repository pages show" — `:91`
- AC-24 "write that document's path into the `doc` query parameter of the URL" — `:92`
- AC-25 "WHEN the page loads with a `doc` parameter that names a listed document, … show that document selected" — `:93`
- AC-26 "IF the `doc` parameter is absent or names no listed document, THEN … the first document of the list selected" — `:94`
- AC-27 "IF the request for a document's content fails, THEN … an error message in the document pane" — `:95`
- AC-28 "IF a document's `type` is none of `specs`, `docs` and `insights`, THEN … the type's own text on a badge of the neutral colour" — `:96`
- AC-29 "opened with `tab=context` in its URL, the Context tab shall be the tab on screen" — `:97`
- AC-30 "each row with a checkbox, the file name, the folder, the type badge and a Preview control" — `:98`
- AC-31 "attached documents first, in attachment order, followed by the other documents in the order the API returned them" — `:99`
- AC-32 "show only the rows whose path contains the typed text, ignoring letter case" — `:100`
- AC-33 "send a `PUT` to the owner's `/context` route with that path appended to the attachment list" — `:101`
- AC-34 "send the attachment list without that path" — `:102`
- AC-35 "drops an attached row onto another attached row, … the dragged path moved to the target's position" — `:103`
- AC-36 "move-earlier or move-later button … that path moved by one position" — `:104`
- AC-37 "WHILE the document list or the attachment list is loading, … keep every checkbox and every move control disabled" — `:105`
- AC-38 "IF saving the attachment list fails, THEN … the last saved list again together with an error message" — `:106`
- AC-39 "IF an attached or inherited path is not in the active repository's document list, THEN … its row marked as not found in this repository" — `:107`
- AC-40 "the heading \"Project context\" and a badge with the number of attached documents out of the number listed" — `:108`
- AC-41 "open a dialog that shows the document's rendered content and its token estimate" — `:109`
- AC-42 "IF the active repository has no documents and nothing is attached, THEN … an empty state that names the folders being searched" — `:110`
- AC-43 "IF no repository is active, THEN … a notice that a repository is needed to list documents" — `:111`
- AC-44 "IF the document list request or the attachment list request fails, THEN … an error message with a control that repeats the request" — `:112`
- AC-45 "store exactly that ordered list as the agent's attachments in place of the previous list" — `:113` — open → Q2
- AC-46 "return the stored `paths` in stored order" — `:114`
- AC-47 "IF a `paths` entry is empty, is absolute, or holds a `..` segment, a backslash or a NUL character, THEN … 422 and leave the stored list unchanged" — `:115` — open → Q2
- AC-48 "leave an agent's `version` unchanged when the agent's attachment list changes" — `:116`
- AC-49 "WHEN an agent or a skill is deleted, the API shall delete its attachment list" — `:117`
- AC-50 "`tokens` value equal to the character count of its text divided by four and rounded up" — `:118`
- AC-51 "the sum of the `tokens` values of the attached documents that are in the list, prefixed with \"≈\" and formatted as a grouped number" — `:119`
- AC-52 "a note saying that the attached documents are injected into every run as an untrusted `## Project context` block" — `:120`
- AC-53 "the heading \"Project context to use\", a badge with the number of attached documents and the line \"Any agent using this skill inherits these documents.\"" — `:121`
- AC-54 "under the label \"SERIALIZES AS\" a read-only box holding the line `## Project specifications` followed by one `- <path>` line per attached document" — `:122`
- AC-55 "store exactly that ordered list as the skill's attachments in place of the previous list" — `:123` — open → Q2
- AC-56 "leave a skill's `body` and `version` unchanged when the skill's attachment list changes" — `:124`
- AC-57 "the sum of the `tokens` values of the skill's attached documents, prefixed with \"≈\"" — `:125`
- AC-58 "read the text of every document attached to that agent and to every skill that is linked to the agent and enabled" — `:126`
- AC-59 "resolve every attached path against the document list of the repository that the reviewed pull request belongs to" — `:127`
- AC-60 "persist for each attachment the document's path and its position and no document text" — `:128`
- AC-61 "take a document's text from the working tree of that repository's clone as it stands when the run starts" — `:129`
- AC-62 "place an agent's own documents in the prompt in the order of the agent's attachment list" — `:130`
- AC-63 "documents inherited from skills after the agent's own, skill by skill in the agent's skill order, and keep a path that occurs more than once at its first position only" — `:131`
- AC-64 "under one `## Project context` heading, each inside its own `<untrusted>` block" — `:132` — heading and per-document block already there (`reviewer-core/src/prompt.ts:168-171`, `:223`)
- AC-65 "label each document's block with that document's repository-relative path" — `:133`
- AC-66 "still emit exactly one opening and one closing delimiter for that document" — `:134` — text half already there (`reviewer-core/src/prompt.ts:32`); the label is unescaped (`:33`)
- AC-67 "append its injection guard to the system prompt of every run, with or without project context" — `:135` — already there (`reviewer-core/src/prompt.ts:160`); test to add
- AC-68 "IF a run has no document to add, THEN … a prompt that holds no `## Project context` section" — `:136` — engine half already there (`reviewer-core/src/prompt.ts:168-171`, `:244`)
- AC-69 "IF an attached path is not in the reviewed repository's document list, or its file is unreadable or empty, THEN … complete the run without that document" — `:137`
- AC-70 "include the `## Project context` section in the prompt of every file" — `:138` — already there (`reviewer-core/src/review/run.ts:150-160`, `:193`); test to add
- AC-71 "the PR page shall show a finding whose rationale names that document's path" — `:139` — manual
- AC-72 "store in the trace's `specs_read` the path of every document placed in the prompt, in prompt order" — `:140`
- AC-73 "store in the trace's `specs_docs` one entry per document placed in the prompt, holding its `path` and its `tokens`" — `:141`
- AC-74 "store in the trace's `prompt_assembly.specs` the full content of the `## Project context` section as sent to the model" — `:142`
- AC-75 "write a Live Log line that states their number and their total token estimate" — `:143`
- AC-76 "a Live Log line of kind `info` that names the path and the reason" — `:144`
- AC-77 "list in the \"Specs read\" row each path of `specs_docs` followed by its token estimate" — `:145`
- AC-78 "IF a trace has an empty `specs_read`, THEN … \"none\"" — `:146` — already there (`…/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:41-42`)
- AC-79 "a Prompt assembly row labelled \"Project context — attached specs (untrusted)\"" — `:147` — row already there (`TraceBody.tsx:88-90`); the label differs (`client/messages/en/runs.json:51`)
- AC-80 "show the full text of `prompt_assembly.specs`" — `:148` — already there (`…/RunTraceDrawer/_components/PromptBlock/PromptBlock.tsx:76-95`); test to add
- AC-81 "a tab named \"Context\" in the tab bar, after the Skills tab in the agent editor and after the Config tab in the skill editor" — `:149`
- AC-82 "each inherited document as a read-only row that names its skill, placed after the agent's own attached rows and before the unattached ones" — `:150`
- AC-83 "an `inherited` list of the documents its linked, enabled skills bring, in prompt order, each with `path`, `skill_id` and `skill_name`" — `:151`
- AC-84 "add the `tokens` values of the inherited documents that are in the list to the token sum of AC-51" — `:152`
- AC-85 "open the `## Project context` section with a trusted rule, outside every `<untrusted>` block" — `:153`
- AC-86 "a `source` of `agent` or `skill` and, for a document inherited from a skill, that skill's name in `skill_name`" — `:154`
- AC-87 "whether the document was attached to the agent or inherited from a skill, naming the skill" — `:155`
- AC-88 "the document's whole path as its title, keep the file name whole and cut the folder part with an ellipsis" — `:156`
- AC-89 "a `lastIndexedSha` or an `updatedAt` different from the one read before the resync request, … request the document list again" — `:157`
- AC-90 "keep the refresh control disabled with a running label and keep the current list on screen" — `:158`
- AC-91 "IF the index state has not changed 120 seconds after the resync request, THEN … stop waiting and show a notice" — `:159`
- AC-92 "IF the resync request is answered with an error, THEN … an error message and leave the list as it was" — `:160`

Non-functional (`spec:200-212`): NFR-1 cost, NFR-2/3/4 security, NFR-5/6 accessibility, NFR-7 i18n, NFR-8 observability (third place already there: `reviewer-core/src/prompt.ts:128` → `server/src/modules/reviews/run-executor.ts:340-357` → `server/src/platform/prompt-log.ts:62-67`), NFR-9/10 compatibility, NFR-11/12/13 performance. Edge cases EC-1…EC-33 (`spec:164-196`) each carry their own `covered by:`.

## 2. Impact map
| Package | Path | New / Modify | Layer or placement | AC |
|---|---|---|---|---|
| server, client | `{server,client}/src/vendor/shared/contracts/platform.ts` | Modify (both) | wire contract | AC-1, 6, 16, 46, 47, 83, NFR-10 |
| server, client | `{server,client}/src/vendor/shared/contracts/trace.ts` | Modify (both) | wire contract | AC-73, 86, NFR-9 |
| server | `server/src/vendor/shared/adapters.ts` | Modify (server copy only) | port | MI-6, NFR-3 |
| reviewer-core | `reviewer-core/src/prompt.ts`, `src/review/run.ts`, `src/index.ts` | Modify | domain service | AC-64…67, 70, 85 |
| server | `server/src/db/schema/agents.ts`, `schema/skills.ts`, `src/db/schema.ts` | Modify | persistence | AC-45, 49, 55, 60 |
| server | `server/src/db/migrations/0016_*.sql`, `meta/0016_snapshot.json`, `meta/_journal.json` | New (generated) | persistence | AC-45, 60 |
| server | `server/src/platform/config.ts`, `server/.env.example` | Modify | config | AC-2 |
| server | `server/src/adapters/docs/fs.ts` | New | driven adapter | AC-1, 3, NFR-3 |
| server | `server/src/adapters/mocks.ts`, `server/src/adapters/index.ts` | Modify | mock / barrel | — |
| server | `server/src/modules/context/{routes,service,repository,helpers,constants,types}.ts` | New | feature module | AC-1…9, 16, 45…50, 55, 56, 58…63, 69, 83 |
| server | `server/src/modules/index.ts`, `server/src/platform/container.ts` | Modify | registry / composition root | — |
| server | `server/src/modules/reviews/deps.ts`, `run-executor.ts` | Modify | port / use case | AC-58…63, 68, 69, 72…76, 86 |
| server | `server/test/{contracts,prompt-callers,prompt-structured}.test.ts` | Modify | tests | — |
| server | `server/test/{config-context-roots,context-discovery,context-service,prompt-log}.test.ts`, `server/test/{context,reviews-context}.it.test.ts` | New | tests | — |
| reviewer-core | `reviewer-core/test/prompt.test.ts`, `test/run.test.ts` | Modify | tests | — |
| client | `client/src/lib/hooks/{core,agents,skills}.ts`, `client/src/lib/types.ts` | Modify | data hooks | MI-1…4, 12, 13 |
| client | `client/messages/en/{context,runs,agents,skills}.json` | Modify | copy | NFR-7, NFR-10 |
| client | `client/src/vendor/ui/nav.ts`, `client/src/vendor/ui/styles.css` | Modify | design system | AC-10, 14 |
| client | `client/src/components/project-context/**` | New | cross-route tier (three routes render it) | AC-28, 30…39, 41…44, 82, 88 |
| client | `client/src/app/repos/[repoId]/context/**` | New | route + `_components/` | AC-11…27, 89…92 |
| client | `client/src/app/agents/[id]/_components/AgentEditor/{AgentEditor.tsx,constants.ts,AgentEditor.test.tsx}`, `…/_components/ContextTab/**` (New) | Modify / New | route-local | AC-29, 40, 51, 52, 81, 84 |
| client | `client/src/app/skills/constants.ts`, `…/SkillDetail/SkillDetail.tsx`, `…/SkillDetail/_components/ContextTab/**` (New), `…/SkillDetailPane/SkillDetailPane.test.tsx` | Modify / New | route-local | AC-29, 53, 54, 57, 81 |
| client | `…/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`, `…/RunTraceDrawer/_components/SpecsRead/**` (New), `…/RunTraceDrawer/RunTraceDrawer.test.tsx` | Modify / New | under the single parent | AC-77…80, 87 |

## 3. Constraints in play
- dependency-cruiser (`server/.dependency-cruiser.cjs`) stays green: `drizzle-only-in-repositories`, `schema-only-in-repositories`, `no-row-types-in-transport`, `no-adapter-to-module`, `no-cross-module-internals`, `no-service-to-container`, `core-purity`, `no-circular`.
- Dual contract copy: `platform.ts` and `trace.ts` change in both copies in Stage 1. `diff -u` on `platform.ts` prints nothing. `diff -u` on `trace.ts` prints only the one hunk that differs at HEAD (the `callers` / `repo_map` comments, lines 44–47).
- `adapters.ts` already differs between the copies at HEAD and holds no wire shape, so the new port goes to the server copy only.
- Migration: `cd server && pnpm db:generate` produces `0016_*.sql`. No hand-written or edited file under `server/src/db/migrations/`. No agent applies it.
- `reviewer-core/src` is compiled by the server typecheck, so Stage 2 is checked with `check-code.sh reviewer-core` plus the two server tests it changes.
- No table for attachments exists at HEAD: `server/src/db/schema/*.ts` holds no agent/skill-to-path relation, and `code_chunks` belongs to the index that NG-4 excludes. The schema change is two new tables.
- i18n: every string of the page, the two tabs and the changed trace rows lives in `client/messages/en/`. Counts are ICU plurals; numbers are `{x, number}`.
- Client styling follows the neighbouring components (`styles.ts` objects, `client/AGENTS.md § Naming`), not the Tailwind bullet of `react-best-practices`.
- No new dependency in any package. No lockfile, `server/package.json`, `server/clones/**` or `.env` change.

## 4. Stages

### Stage 1 — Contracts and the documents port
Track: shared · After: —
Files: `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, `server/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/contracts/trace.ts`, `server/src/vendor/shared/adapters.ts`, `server/test/contracts.test.ts`
Read first: `server/src/vendor/shared/contracts/platform.ts:255-283` — the pre-wired `SpecFile` / `IndexStatus`; `server/src/vendor/shared/contracts/trace.ts:39-93` — `PromptAssembly`, `RunTrace`; `server/src/vendor/shared/adapters.ts:215-250` — the `GitClient` port as the neighbour; `server/test/contracts.test.ts:160-180` — the `RunTrace` parse test; `spec:279-333` — the contract block.
Steps:
1. In `platform.ts` (both copies, identical text) extend `SpecFile`: add `type: z.string()`, `tokens: z.number().int().nonnegative()`, `agent_count: z.number().int().nonnegative().default(0)`. Keep `content`, `size`, `updated_at` nullish. Leave `IndexStatus` untouched.
2. Add, derived from `SpecFile` so that no second copy of its fields exists: `SpecDocument = SpecFile.pick({ path, type, tokens }).extend({ content: z.string() })` and `ContextDocumentList = { roots: string[], documents: SpecFile[] }`.
3. Add `ContextPath`: `z.string().min(1)` with one refine rejecting a leading `/`, a `..` segment, a backslash and a NUL character.
4. Add `ContextAttachmentsInput = { paths: z.array(ContextPath) }` with a refine that rejects a repeated path (Q2, the assumed answer).
5. Add `ContextInheritedDoc = { path, skill_id, skill_name }` and `ContextAttachments = { paths: string[], inherited: ContextInheritedDoc[] optional }`. Each schema exports a type of the same name.
6. In `trace.ts` (both copies) add `SpecDocRead = { path: string, tokens: int ≥ 0, source: z.enum(['agent','skill']).optional(), skill_name: z.string().nullish() }` and `specs_docs: z.array(SpecDocRead).optional()` on `RunTrace`. Do not touch the comment lines that already differ.
7. In `server/src/vendor/shared/adapters.ts` add `RepoDocsReader`:
   - `listMarkdown(clonePath: string): Promise<string[]>` — repository-relative, forward slashes; `[]` when the directory is missing.
   - `readText(clonePath: string, relPath: string): Promise<string | null>` — `null` when missing, unreadable, or resolving outside the clone.
Skills: `zod` → `references/object-pick-omit.md`, `references/object-optional-vs-nullable.md`, `references/schema-string-validations.md`, `references/type-export-schemas-and-types.md` — derive instead of redeclaring; optional for a key absent in stored traces. `onion-architecture` → `rules/zod-contracts.md` (both copies; a contract is a transport shape), `rules/ports-and-di.md` (a port is named after the capability).
Tests to add: `server/test/contracts.test.ts`:
- a `RunTrace` without `specs_docs` parses, and one with it parses (NFR-9);
- `ContextAttachmentsInput` rejects `''`, `/abs.md`, `a/../b.md`, `a\\b.md`, `a\0.md` and a repeated path, and accepts `docs/a.md` (AC-47);
- a `SpecFile` list entry parses without `content` (NFR-11).
Done when: `diff -u server/src/vendor/shared/contracts/platform.ts client/src/vendor/shared/contracts/platform.ts` prints nothing; the same `diff -u` on `trace.ts` prints only the pre-existing comment hunk; `.claude/agents/scripts/check-code.sh --no-tests server client reviewer-core` and `.claude/agents/scripts/check-code.sh server -- test/contracts.test.ts` pass.

### Stage 2 — Engine: documents with paths, the trusted rule, a safe label
Track: server · After: 1
Files: `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/run.ts`, `reviewer-core/src/index.ts`, `reviewer-core/test/prompt.test.ts`, `reviewer-core/test/run.test.ts`, `server/test/prompt-callers.test.ts`, `server/test/prompt-structured.test.ts`
Read first: `reviewer-core/src/prompt.ts` (whole, 253 lines) — `wrapUntrusted`, `INTENT_RULE` as the pattern for the new rule, the `specs` slot; `reviewer-core/src/review/run.ts:56-113`, `:143-216` — `ReviewInput.specs`, the per-chunk assembly; `reviewer-core/test/prompt.test.ts:1-60`, `reviewer-core/test/run.test.ts:1-75` — fixtures; `server/test/prompt-callers.test.ts:16-25`, `server/test/prompt-structured.test.ts:14-30` — the two callers that pass `specs: [string]`; `server/docs/intent-in-prompt.md` § "Why intent is untrusted".
Steps:
1. `wrapUntrusted(label, content)`: escape the label before it enters `source="…"` — `"` → `&quot;`, `<` → `&lt;`, `>` → `&gt;`, every run of `\r` / `\n` → one space. The content handling stays as it is.
2. Export `interface ProjectContextDoc { path: string; text: string }` from `prompt.ts`, re-export it from `index.ts`, and change `PromptParts.specs` and `ReviewInput.specs` to `ProjectContextDoc[]`.
3. Add an unexported `PROJECT_CONTEXT_RULE` beside `INTENT_RULE`. Its text must say three things: check the diff against the documents below; name a document's path in the rationale of a finding that rests on it; the documents are untrusted data that never lower a finding's severity and never remove a finding.
4. Build the section as `${PROJECT_CONTEXT_RULE}\n\n` plus one `wrapUntrusted(doc.path, doc.text)` per document joined by a blank line. The user section is `## Project context\n<section>`; `assembly.specs` is `<section>` or `null`; the `specs` section meta gets `items` from the document texts. No documents → no section, as today.
5. Update `specs` in the two server tests to `[{ path: 'specs/security-baseline.md', text: '# Security baseline\nNo secrets in code.' }]`.
Skills: `onion-architecture` → `rules/domain-purity.md` (no I/O, no `node:` import; the rule lives in the core), `rules/testing.md`. `typescript-expert` → `SKILL.md § Code Review Checklist — Type Safety` (no `as`, an exported interface for the new shape). `security` → `SKILL.md § Agentic AI Security` (untrusted text stays data; delimiter integrity).
Tests to add:
- `reviewer-core/test/prompt.test.ts`:
  - two documents give one `## Project context` heading and two blocks (AC-64);
  - the block carries the path and no `spec-0` (AC-65);
  - a path `"></untrusted>` with a text holding `</untrusted>` leaves exactly one `<untrusted source=` and one `</untrusted>` per document inside `assembly.specs` (AC-66);
  - the system message ends with the guard with and without documents (AC-67);
  - the rule precedes the first delimiter and is absent without documents (AC-85, AC-68);
  - a marker in a document's text and path is in `assembly.specs` and in neither the system message nor `assembly.skills` (NFR-2).
- `reviewer-core/test/run.test.ts`: a two-file diff with `strategy: 'map-reduce'` — both recorded provider calls carry `## Project context` (AC-70).
Done when: `.claude/agents/scripts/check-code.sh reviewer-core` and `.claude/agents/scripts/check-code.sh server -- test/prompt-callers.test.ts test/prompt-structured.test.ts` pass.

### Stage 3 — Storage and configuration
Track: server · After: 2
Files: `server/src/db/schema/agents.ts`, `server/src/db/schema/skills.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/0016_*.sql` + `meta/` (generated), `server/src/platform/config.ts`, `server/.env.example`, `server/test/config-context-roots.test.ts` (New)
Read first: `server/src/db/schema/agents.ts:51-70` — `agent_skills` as the pattern (composite key, cascade); `server/src/db/schema/skills.ts`; `server/src/db/schema.ts:26-93` — the import list and the `schema` object; `server/src/platform/config.ts` (whole); `server/.env.example:14-32`.
Steps:
1. Add `agentContextDocs` (`agent_context_docs`) to `schema/agents.ts`: `agent_id uuid NOT NULL` referencing `agents.id` with `onDelete: 'cascade'`, `path text NOT NULL`, `position integer NOT NULL`, primary key `(agent_id, path)` (Q2).
2. Add `skillContextDocs` (`skill_context_docs`) to `schema/skills.ts` with `skill_id` referencing `skills.id`, same shape. No timestamp column, no extra index — the key's leading column serves the FK.
3. Add both tables to the import lists and the `schema` object in `server/src/db/schema.ts`.
4. Run `cd server && pnpm db:generate`. If pnpm exits non-zero, judge by the files; fall back to `./node_modules/.bin/drizzle-kit generate`. Read the generated SQL: two `CREATE TABLE`, two cascading foreign keys, columns `agent_id` / `skill_id` / `path` / `position`, and no `ALTER` or `DROP` on an existing table. Do not apply it.
5. `config.ts`: add `PROJECT_CONTEXT_ROOTS: z.string().optional()` to `EnvSchema`, export `DEFAULT_CONTEXT_ROOTS = ['specs', 'docs', 'insights']`, and add `contextRoots: string[]` to `AppConfig` — the value split on commas, trimmed, empty entries dropped; the default when nothing remains.
6. `.env.example`: a commented `PROJECT_CONTEXT_ROOTS=` line naming the default.
Skills: `drizzle-orm-patterns` → `references/schema-definition.md § Composite Primary Key`, `references/migrations.md` (generate, never push). `postgresql-table-design` → `SKILL.md § Constraints`, `§ Indexing`, `§ Data Types` (FK action stated, FK covered by the key, `TEXT`, `NOT NULL`). `onion-architecture` → `rules/drizzle-persistence.md § Migrations`, `rules/zod-contracts.md` (environment parsed once, in `platform/config.ts`).
Tests to add: `server/test/config-context-roots.test.ts` — `loadConfig({})` yields the three defaults; `PROJECT_CONTEXT_ROOTS='adr, specs'` yields `['adr','specs']`; an empty value yields the defaults (AC-2, first half).
Done when: a single new `0016_*.sql` and `meta/0016_snapshot.json` exist and `_journal.json` has idx 16; a second `./node_modules/.bin/drizzle-kit generate` in `server/` prints "No schema changes, nothing to migrate"; `.claude/agents/scripts/check-code.sh server -- test/config-context-roots.test.ts` passes.

### Stage 4 — Document reader: filesystem adapter and pure discovery
Track: server · After: 3
Files: `server/src/adapters/docs/fs.ts` (New), `server/src/adapters/mocks.ts`, `server/src/adapters/index.ts`, `server/src/modules/context/helpers.ts` (New), `server/src/modules/context/constants.ts` (New), `server/test/context-discovery.test.ts` (New)
Read first: `server/src/adapters/git/simple-git.ts:22-38`, `:154-172` — the path guard of `readFileAt` and the unguarded `readFile` that is not to be reused; `server/src/modules/repo-intel/pipeline/walk.ts` — the existing directory-walk pattern; `server/src/adapters/mocks.ts:249-314` — the mock style; `server/src/platform/prompt-log.ts:41-43` — `approxTokens`; `server/test/conventions.it.test.ts:100-112` — a temporary tree as a fixture.
Steps:
1. `FsRepoDocsReader implements RepoDocsReader`, `listMarkdown`:
   - resolve the clone root with `realpath`; any failure → `[]`;
   - walk with `readdir(…, { withFileTypes: true })`;
   - skip every entry whose name starts with a dot; descend only into real directories — a directory link is not followed;
   - take regular files whose name ends in `.md`;
   - take a `.md` symbolic link only when its `realpath` is a regular file inside the resolved root;
   - return forward-slash relative paths.
2. `readText`: refuse an empty path, a leading `/`, a `..` segment, a backslash and a NUL; `realpath` the joined path and require it to lie inside the resolved root; read as UTF-8; every failure → `null`.
3. `MockRepoDocsReader` in `mocks.ts`, built from `Record<clonePath, Record<relPath, text>>`; export `FsRepoDocsReader` from the adapters barrel.
4. `helpers.ts`, pure:
   - `classifyDocuments(paths, roots)` → `{ path, type }[]`. It drops a path with a dot-directory segment, a path not ending in `.md`, and a path with no directory segment equal to a root. `type` is the first such segment from the repository root. Sort by root index, then by `path` (plain code-unit comparison).
   - `docTokens(text)` = `approxTokens(text.length)`.
5. `constants.ts`: `MARKDOWN_EXTENSION = '.md'`, `READ_CONCURRENCY = 16`.
Skills: `onion-architecture` → `rules/ports-and-di.md § Adding a new external capability` (port → mock → adapter, in that order), `rules/layers.md` (the walk is an adapter, the classification is pure). `security` → `SKILL.md § File Upload Security — Path traversal`, `§ Framework Security Quirks` (`path.join()` with user input: resolve, then prove containment).
Tests to add: `server/test/context-discovery.test.ts` over a temporary tree:
- with default roots, files under `specs/`, `docs/`, `insights/` at two depths are returned; a `.md` outside them and a `.txt` inside them are not (AC-2);
- a custom root list is followed (AC-2);
- `.devdigest/specs/a.md` and `.github/docs/b.md` are absent (AC-3);
- `docs/specs/x.md` is `docs`, `specs/x.md` is `specs` (AC-4);
- order is specs, docs, insights, then path ascending (AC-5);
- a 10-character text is 3 tokens, an empty one 0 (AC-50);
- a `.md` link to a file outside the tree is neither listed nor read, and `readText(root, '../x.md')` is `null` (EC-5, NFR-3).
Done when: `.claude/agents/scripts/check-code.sh server -- test/context-discovery.test.ts` passes with typecheck and depcruise green.

### Stage 5 — Context module: repository, service, routes, wiring
Track: server · After: 4
Files: `server/src/modules/context/{types,repository,service,routes}.ts` (New), `server/src/modules/context/helpers.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/test/context-service.test.ts` (New), `server/test/context.it.test.ts` (New)
Read first: `server/src/modules/blast/{routes,service,types}.ts` — the newest module: service from the container, consumer-declared ports, response schemas; `server/src/modules/agents/repository.ts:189-251` and `server/src/modules/skills/repository.ts:108-162` — the link-table joins and the transaction precedent; `server/src/platform/container.ts:141-227`; `server/src/modules/index.ts`; `server/src/modules/_shared/{context,schemas}.ts`; `server/test/skills.it.test.ts:1-110` and `server/test/conventions.it.test.ts:95-150` — the app factory and a repo row with a temporary `clonePath`.
Steps:
1. `types.ts` declares the ports and nothing from the container:
   - `ContextStore`, the repository port: `agentPaths(agentId)`, `skillPaths(skillId)`, `replaceAgentPaths(agentId, paths)`, `replaceSkillPaths(skillId, paths)`, `linkedSkillPaths(agentId)` → `{ skillId, skillName, path }[]`, `usage(workspaceId)` → `{ path, agentId }[]`.
   - `ContextRepoReader.getById` → `{ id, clonePath } | undefined`; `ContextOwnerReader.getById` → `{ id } | undefined`.
   - `ContextDeps { store, repos, agents, skills, docs: RepoDocsReader, roots: readonly string[] }`.
2. `repository.ts` — `ContextRepository implements ContextStore`:
   - reads are ordered by `position`;
   - `replace*` is a delete and an insert with `position = index` inside one `db.transaction`;
   - `linkedSkillPaths` joins `agent_skills` → `skills` (enabled only) → `skill_context_docs`, ordered by `agent_skills.order`, the skill id, `position`;
   - `usage` is two selects: direct attachments joined to `agents` by workspace, and skill attachments joined through enabled skills and `agent_skills` to `agents` by workspace.
3. `helpers.ts`, pure: `mergeAttachments(own, skills)` → ordered `{ path, source: 'agent' | 'skill', skillId, skillName }[]`, own first, then skill by skill, a repeated path kept at its first position; `countAgentsByPath(rows)` → distinct agents per path.
4. `service.ts` — `ContextService(deps)`; a missing owner or repository throws `NotFoundError`:
   - `listDocuments(workspaceId, repoId)` — a repository without `clonePath` gives `{ roots, documents: [] }`. Otherwise walk, classify, read each file in batches of `READ_CONCURRENCY` for `tokens` (an unreadable file counts 0), and fill `agent_count`. No `content` key.
   - `getDocument(workspaceId, repoId, path)` — walk and classify; a path that is not in that list throws `NotFoundError` before any read; a `null` read also throws it.
   - `getAgentContext` / `setAgentContext` — `{ paths, inherited }`, where `inherited` is the `skill` entries of `mergeAttachments`.
   - `getSkillContext` / `setSkillContext` — `{ paths }`.
   - `resolveForRun(workspaceId, repoId, agentId)` → `{ documents: { path, text, tokens, source, skillName }[], skipped: { path, reason }[] }`. It takes the merged list, keeps the paths that are in the repository's classified list, and reads each one. Reasons: `not found in this repository`, `unreadable`, `empty`.
5. `routes.ts` — the service is `app.container.contextService`; every handler is `getContext` plus one service call:
   - `GET /repos/:id/context` — response `ContextDocumentList`.
   - `GET /repos/:id/context/document` — querystring `z.object({ path: z.string() })`, response `SpecDocument`.
   - `GET` and `PUT /agents/:id/context`, `GET` and `PUT /skills/:id/context` — body `ContextAttachmentsInput`, response `ContextAttachments`.
6. `container.ts`: `overrides.repoDocs`, getters `repoDocs`, `contextRepo`, `contextService` (built from `contextRepo`, `repoRepo`, `agentsRepo`, `skillsRepo`, `repoDocs`, `config.contextRoots`). `modules/index.ts`: one import and one entry, `context`.
Skills: `onion-architecture` → `rules/layers.md`, `rules/fastify-transport.md` (four things per route, no adapter call), `rules/drizzle-persistence.md` (no row type above the repository), `rules/ports-and-di.md` (named ports, the container is the only `new`), `rules/testing.md`. `fastify-best-practices` → `rules/routes.md`, `rules/testing.md` (`app.inject()`). `drizzle-orm-patterns` → `references/queries-joins-aggregations.md`, `references/transactions.md`. `zod` → `references/parse-validate-early.md`. `security` → `SKILL.md § A01` (every owner looked up by workspace), `§ File Upload Security — Path traversal`.
Tests to add:
- `server/test/context-service.test.ts` (hermetic, `MockRepoDocsReader` and an in-memory `ContextStore`): `resolveForRun` returns A, B, C for an agent attaching A with skills attaching B and A, then C (AC-63); a missing path, an empty document and an unreadable one are skipped with their reasons (AC-69); a repository without a clone lists nothing (AC-8).
- `server/test/context.it.test.ts` (Docker, real adapter over a temporary clone), each case following its `verify:` clause: AC-1, AC-6, AC-7, AC-8, AC-9 (six routes), AC-16, AC-45, AC-46, AC-47 (422 and the earlier list survives, the repeated path included), AC-48, AC-49, AC-55, AC-56, AC-83, NFR-1 (row counts of `agent_runs` and `run_traces` unchanged across list, document, attachment and resync requests), NFR-3 (a link outside the clone: not listed, 404), NFR-11 (no `content` key), NFR-13 (300 documents in one response).
Done when: `.claude/agents/scripts/check-code.sh server` passes (typecheck, depcruise, unit lane) and `.claude/agents/scripts/check-code.sh server -- test/context.it.test.ts` passes — a SKIP means Docker was absent and is reported as such.

### Stage 6 — The run: resolve, hand over, trace, Live Log
Track: server · After: 5
Files: `server/src/modules/reviews/deps.ts`, `server/src/modules/reviews/run-executor.ts`, `server/test/reviews-context.it.test.ts` (New), `server/test/prompt-log.test.ts` (New)
Read first: `server/src/modules/reviews/deps.ts` (whole) — `IntentResolver` as the pattern; `server/src/modules/reviews/run-executor.ts:162-235` — `resolveIntent`, the never-`error` degradation — and `:238-441` — `runOneAgent`, the trace literal; `server/test/reviews-skills.it.test.ts` (whole) — `makeApp`, `setupPr`, `runAndTrace`; `server/test/helpers/runs.ts`; `server/src/platform/prompt-log.ts`; `server/docs/prompt-logging.md`.
Steps:
1. `deps.ts`: declare `ProjectContextResolver { resolveForRun(workspaceId, repoId, agentId) }` with the result shape of Stage 5 restated structurally, and add `readonly contextService: ProjectContextResolver` to `ReviewsDeps`. No import from `modules/context`.
2. `run-executor.ts`: a private `resolveProjectContext(workspaceId, pull, agent, runLog)` called in `runOneAgent` after the skills step:
   - emit `runLog.tool('Loading project context…')` and call the resolver inside `try`;
   - a throw becomes `runLog.info('Project context unavailable — reviewing without it: <message>')` and an empty result — never `runLog.step`, never `error`;
   - each skipped entry becomes `runLog.info('Project context: skipped <path> — <reason>')`;
   - with documents: `runLog.info('Project context in prompt (<n> document(s), ≈ <sum of tokens> tok)')`;
   - without: `runLog.info('No project context — the prompt carries no project context section')`.
3. Pass `specs: documents.map(({ path, text }) => ({ path, text }))` to `reviewPullRequest` only when the list is not empty.
4. In the success trace set `specs_read` to the paths and `specs_docs` to `{ path, tokens, source, skill_name }` per document, both in prompt order. `traceFromBuffer` stays as it is.
Skills: `onion-architecture` → `rules/ports-and-di.md` (consumer-declared port, satisfied structurally), `rules/testing.md`. `fastify-best-practices` → `rules/testing.md` (`.inject(`). `security` → `SKILL.md § A09` (log names and sizes, never document text) with `server/docs/prompt-logging.md`.
Tests to add:
- `server/test/reviews-context.it.test.ts` (Docker; repository rows with a temporary `clonePath`; mock LLM and git), each case following its `verify:` clause: AC-58, AC-59, AC-60, AC-61, AC-62, AC-63, AC-68, AC-69, AC-72, AC-73, AC-74, AC-75, AC-76, AC-86, NFR-1 (equal `completeStructured` call counts with and without documents), NFR-2 (marker in text and file name), NFR-3 (an attached link pointing outside the clone leaves no text in the trace), NFR-12 (a document over 4000 characters arrives whole).
- `server/test/prompt-log.test.ts` (hermetic): `logPromptAssembly` over the sections of `assemblePrompt` with two documents logs a `specs` section with `chars`, and the serialised log object holds none of the document text (NFR-8).
Done when: `.claude/agents/scripts/check-code.sh server` passes and `.claude/agents/scripts/check-code.sh server -- test/reviews-context.it.test.ts test/reviews-skills.it.test.ts` passes (SKIP = no Docker, reported).

### Stage 7 — Client foundations: hooks, catalog, shared pieces, sidebar
Track: client · After: 1
Files: `client/src/lib/hooks/core.ts`, `client/src/lib/hooks/agents.ts`, `client/src/lib/hooks/skills.ts`, `client/src/lib/types.ts`, `client/messages/en/context.json`, `client/src/vendor/ui/nav.ts`, `client/src/vendor/ui/styles.css`, `client/src/components/project-context/{DocTypeBadge.tsx,DocPath.tsx,DocumentContent.tsx,helpers.ts,constants.ts,index.ts}` (New) with `DocTypeBadge.test.tsx`, `DocPath.test.tsx`, `client/src/components/app-shell/navigation.test.tsx` (New)
Read first: `client/src/lib/hooks/core.ts:120-137` — the pre-wired hooks; `client/src/lib/hooks/agents.ts:93-118` — a get/replace pair with invalidation; `client/messages/en/context.json` — the copy being replaced; `client/src/vendor/ui/nav.ts:21-46`; `client/src/vendor/ui/shell/Sidebar.tsx`, `shell/types.ts:19-37` — what the nav test renders; `client/src/vendor/ui/primitives/Markdown.tsx`; `client/src/vendor/ui/styles.css:195-230`; `client/src/components/run-cost/` — a small cross-route folder as the pattern.
Steps:
1. `core.ts`:
   - `useContextFiles(repoId, enabled = true)` returns `ContextDocumentList` under the key `["context", repoId]`;
   - add `useContextDocument(repoId, path)` under `["context-doc", repoId, path]`, enabled only with both, calling `/repos/${repoId}/context/document?path=${encodeURIComponent(path)}`;
   - delete `useReindexContext` and the `IndexStatus` import.
2. `agents.ts`: `useAgentContext(agentId)` under `["agent-context", agentId]` and `useSetAgentContext()` doing `api.put(`/agents/${agentId}/context`, { paths })`; on success set the cached value and invalidate `["context"]`.
3. `skills.ts`: `useSkillContext` / `useSetSkillContext` likewise under `["skill-context", skillId]`, also invalidating `["agent-context"]`.
4. `types.ts`: re-export `ContextDocumentList`, `SpecDocument`, `ContextAttachments`, `ContextInheritedDoc`.
5. Rewrite `context.json`: keep `title`, remove every other pre-wired key, add the catalog below.
6. `nav.ts`: add `{ key: "context", label: "Project Context", icon: "Folder", href: "/repos/:repoId/context" }` to WORKSPACE after `pulls`.
7. `components/project-context/`:
   - `DocTypeBadge` — a `Badge` with the type's own text; colours for `specs`, `docs`, `insights` from `constants.ts`, the neutral colour otherwise.
   - `DocPath` — a wrapper with `title={path}`, the file name in a span that never shrinks, the folder in a span with `overflow: hidden; textOverflow: "ellipsis"; whiteSpace: "nowrap"`.
   - `DocumentContent` — `<div className="dd-doc"><Markdown>{content}</Markdown></div>`.
   - `helpers.ts` — `splitDocPath(path)`, `matchesDocQuery(path, query)` (case-insensitive substring).
8. `styles.css`: rules under `.dd-doc .dd-md` giving `h1`–`h4` sizes above the body text and weight, and `ul` / `ol` their markers and indent.
Catalog (`client/messages/en/context.json`):
- `title` — "Project Context"
- `page.caption` "PROJECT CONTEXT" · `page.search` "Search documents…"
- `page.fileCount` "{count, plural, one {# file} other {# files}}" · `page.usedBy` "Used by {count, plural, one {# agent} other {# agents}}"
- `page.loadError` "Couldn’t load the documents" · `page.documentError` "Couldn’t load this document"
- `page.emptyTitle` "No documents found" · `page.emptyBody` "No Markdown files under {roots} in this repository."
- `page.refresh` "Refresh from GitHub" · `page.refreshing` "Syncing…"
- `page.refreshError` "The sync could not be started. The list is unchanged." · `page.refreshSlow` "The sync is taking longer than expected. The list may be out of date."
- `attach.filter` "Filter documents…" · `attach.toggle` "Attach {path}" · `attach.preview` "Preview" · `attach.previewOf` "Preview {path}"
- `attach.moveEarlier` "Move {path} earlier in the prompt" · `attach.moveLater` "Move {path} later in the prompt"
- `attach.notFound` "not found in this repository" · `attach.via` "via {skill}" · `attach.tokens` "≈ {count, number} tokens"
- `attach.saveError` "Could not save the attached documents. Nothing was changed." · `attach.loadError` "Couldn’t load the documents"
- `attach.noRepo` "Add or select a repository to list its documents." · `attach.empty` "No Markdown files under {roots} in this repository."
- `agentTab.title` "Project context" · `agentTab.count` "{attached, number} of {total, number} attached"
- `agentTab.hint` "Order matters — earlier documents appear earlier in the ## Project context block. Drag a row, or use ↑ / ↓."
- `agentTab.note` "Injected as an untrusted block (## Project context) into every run."
- `skillTab.title` "Project context to use" · `skillTab.count` "{count, number} attached"
- `skillTab.inherit` "Any agent using this skill inherits these documents."
- `skillTab.serializesAs` "SERIALIZES AS" · `skillTab.serializedHeading` "## Project specifications"

Skills: `frontend-ui-architecture` → `placement.md` (the ladder: three routes render these, so the cross-route tier is earned), `devdigest.md` (hooks by area; the catalog owns the text). `react-best-practices` → `SKILL.md § Component Design`, `§ Accessibility`. `react-testing-library` → `SKILL.md § Query Priority`. `security` → `SKILL.md § A05 — XSS` (no `dangerouslySetInnerHTML`; the Markdown primitive renders no raw HTML).
Tests to add:
- `DocTypeBadge.test.tsx` — `adr` renders "adr" with none of the three type colours; the three known types render their text (AC-28, NFR-6).
- `DocPath.test.tsx` — the title holds the whole path; the folder span carries the ellipsis style and the name span does not (AC-88).
- `navigation.test.tsx` — `Sidebar` with `repoId: "r1"` renders a "Project Context" link to `/repos/r1/context`, and `activeKeyFor("/repos/r1/context")` is `"context"` and marks that item (AC-10).
Done when: `.claude/agents/scripts/check-code.sh client` passes; `grep -rn "useReindexContext\|devdigest/specs\|chunks" client/src client/messages/en/context.json` prints nothing.

### Stage 8 — The Project Context page
Track: client · After: 7
Files (New): `client/src/app/repos/[repoId]/context/page.tsx`, `…/context/helpers.ts`, `…/context/_components/ProjectContextView/{ProjectContextView.tsx,ProjectContextView.test.tsx,styles.ts,index.ts}`, `…/context/_components/DocumentList/{DocumentList.tsx,index.ts}`, `…/context/_components/DocumentPane/{DocumentPane.tsx,index.ts}`
Read first: `client/src/app/repos/[repoId]/conventions/page.tsx` and `…/conventions/_components/ConventionsView/ConventionsView.tsx:30-60`, `:155-185` — the thin page, the repo-not-found branch, loading / error / empty; `…/ConventionsView/ConventionsView.test.tsx:1-60` — providers and navigation mocks; `client/src/lib/repo-context.tsx:58-72`; `client/src/components/repo-not-found/RepoNotFound.tsx`; `i/img.png` — the layout. From the frame take the two columns, the caption, the row shape, the document header and "Used by N agents". Leave out the Edit toggle, the add / folder / upload icons, the COVERAGE ring, the "Indexed … chunks" footer and the `.devdigest/specs/` caption.
Steps:
1. `page.tsx`: a server component rendering `<Suspense><ProjectContextView /></Suspense>`.
2. `ProjectContextView` (client): `repoId` from `useParams`; `useRepoNotFound(repoId)` → `<RepoNotFound />` inside `AppShell`, with the list hook disabled (`useContextFiles(repoId, !repoNotFound)`).
3. `helpers.ts`: `selectedPath(documents, docParam)` — the `doc` value when it names a listed document, otherwise the first document's path, otherwise `null`.
4. `DocumentList`:
   - the caption, the root names as `specs/ · docs/ · insights/` from `roots`, and a search input held in component state;
   - one row per document that matches `matchesDocQuery` — a button with `DocPath` and `DocTypeBadge`, `aria-current` on the selected one;
   - a footer with `page.fileCount`;
   - states: `Skeleton` while loading, `ErrorState` with `onRetry={refetch}` on failure, `EmptyState` with `page.emptyBody` and the joined roots when the list is empty.
5. Selecting a row calls `router.push` with `doc=<path>` set on the current query. The default selection writes nothing to the URL.
6. `DocumentPane`: the file name, `page.usedBy` from the selected document's `agent_count`, then `useContextDocument(repoId, selected)` — `Skeleton` while loading, `ErrorState` with `page.documentError` on failure, `DocumentContent` otherwise.
Skills: `frontend-ui-architecture` → `placement.md § Components`, `§ The component folder`, `devdigest.md` (new routes start server-first), `logic.md § Container / Presentational`. `next-best-practices` → `file-conventions.md`, `rsc-boundaries.md`, `suspense-boundaries.md § useSearchParams`. `react-best-practices` → `SKILL.md § Derive, Don't Store` (the selection is derived from the URL and the list), `§ Conditional Rendering`, `§ Accessibility`. `react-testing-library` → `SKILL.md § Async Testing`, `§ Mocking Strategies`.
Tests to add: `ProjectContextView.test.tsx` — `fetch` mocked, catalogs `context` and `common`, each case following its `verify:` clause: AC-11, AC-12, AC-13, AC-15, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27, NFR-4 (a raw `<script>` and a raw `<img onerror>` render neither element), NFR-11 (the only document request is the one for the selected row).
Done when: `.claude/agents/scripts/check-code.sh client -- ProjectContextView` passes with the typecheck green.

### Stage 9 — Refresh: resync and wait for the index state
Track: client · After: 8
Files: `client/src/lib/hooks/core.ts`, `client/src/lib/hooks/core.test.tsx` (New), `client/src/app/repos/[repoId]/context/_components/DocumentList/DocumentList.tsx`, `…/ProjectContextView/ProjectContextView.tsx`, `…/ProjectContextView/ProjectContextView.test.tsx`
Read first: `client/src/lib/hooks/blast.ts:9`, `:35-72` — the wait this stage mirrors; `client/src/lib/hooks/blast.test.tsx` (whole) — fake timers and the module mock; `client/src/lib/hooks/repo-intel.ts`; `…/BlastRadiusCard/_components/DegradedNotice/DegradedNotice.tsx` — the control with its running label.
Steps:
1. `core.ts`: add `useContextRefresh(repoId)` returning `{ start, isRunning, timedOut, failed, ready }`. It is built from `useRepoIntelStatus(repoId, waiting)` and `useResyncRepoIntel(repoId)`, with `RESYNC_POLL_TIMEOUT_MS` imported from `./blast`:
   - the stamp is `${lastIndexedSha}@${updatedAt}`;
   - `start` clears `timedOut` and `failed`, remembers the stamp read before the request, and calls the mutation;
   - `onSuccess` begins the wait; `onError` sets `failed` and starts no polling;
   - a stamp different from the remembered one ends the wait and invalidates `["context", repoId]` and `["context-doc", repoId]`;
   - 120 seconds without a change ends the wait and sets `timedOut`;
   - `ready` is false until an index state has been read.
2. `DocumentList` header: one `Button` (icon `RefreshCw`) with the accessible name `page.refresh`. It is disabled while `isRunning` or not `ready`, and reads `page.refreshing` while running. The rows stay mounted throughout.
3. `ProjectContextView`: `role="alert"` lines for `page.refreshError` (when `failed`) and `page.refreshSlow` (when `timedOut`).
Skills: `react-best-practices` → `SKILL.md § Hooks — useEffect Rules` (the timer and the poll are the external system; clean both up), `§ Data Fetching`. `frontend-ui-architecture` → `logic.md § Hooks are the seam, not the home`. `react-testing-library` → `SKILL.md § Hook Testing`, `§ Timers`.
Tests to add:
- `core.test.tsx`, modelled on `blast.test.tsx`: a changed stamp invalidates the list key once (AC-89); 120 s without a change sets `timedOut` and ends the wait (AC-91); a rejected mutation sets `failed` and starts no wait (AC-92).
- `ProjectContextView.test.tsx`: activating the control sends `POST /repos/:id/resync` and no list request follows before the stamp changes (AC-17); between the request and the change the control is disabled, reads the running label, and the rows stay (AC-90).
Done when: `.claude/agents/scripts/check-code.sh client` passes, `blast.test.tsx` unchanged and green.

### Stage 10 — The attachment editor shared by both tabs
Track: client · After: 9
Files (New): `client/src/components/project-context/useAttachments.ts`, `…/project-context/AttachmentEditor/{AttachmentEditor.tsx,AttachmentRow.tsx,helpers.ts,styles.ts,index.ts,AttachmentEditor.test.tsx}`, `…/project-context/PreviewDialog/{PreviewDialog.tsx,index.ts}`; Modify `client/src/components/project-context/index.ts`
Read first: `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx` (whole) with its `helpers.ts`, `styles.ts` — the optimistic override, drag, the ↑/↓ buttons, nothing clickable before the links load; `…/SkillsTab/SkillsTab.test.tsx:60-110`; `…/RunTraceDrawer/_components/PromptBlock/PromptBlock.tsx:84-97` — `Modal` use; `client/src/lib/toast.tsx`; `i/img_1.png`, `i/img_2.png` — the row.
Steps:
1. `useAttachments(owner: { kind: "agent" | "skill"; id: string })` composes `useActiveRepo`, `useContextFiles(repoId, !!activeRepo)`, the owner's get and set hooks, and a `pending` override like `SkillsTab`'s. It returns `{ repoState: "loading" | "none" | "ready", documents, roots, paths, inherited, loading, failed, retry, commit(nextPaths) }`. `commit` sets the override, calls the mutation and, on error, drops the override and raises `toast.error(t("attach.saveError"))`.
2. `helpers.ts`, pure: `buildRows(documents, paths, inherited, filter)` → own attached rows in attachment order, then inherited rows, then the remaining documents in API order. A path absent from `documents` yields a row with `missing: true`. The filter applies to every row. Also `move`, `toggle`, `sumTokens(documents, paths, inherited)`.
3. `AttachmentRow`:
   - a native `<input type="checkbox">` named `attach.toggle` with the path, disabled while loading;
   - `DocPath`; `DocTypeBadge`, or the `attach.notFound` label on a missing row;
   - on an inherited row a plain span with `attach.via` and no checkbox or move button;
   - move buttons named `attach.moveEarlier` / `attach.moveLater` on own attached rows, the first and last disabled;
   - a Preview control named `attach.previewOf`, a labelled button or an icon button per the `preview` prop, absent on a missing row.
4. Own attached rows are `draggable`; a drop on another own attached row commits `move(paths, from, to)`.
5. `AttachmentEditor({ state, preview })`: the filter input, then one of — the `attach.noRepo` notice (and no list request) when `repoState` is `none`; `Skeleton` while loading; `ErrorState` with `onRetry={state.retry}` on failure; the `attach.empty` line when there are no documents and nothing is attached; the rows.
6. `PreviewDialog({ repoId, path, onClose })`: `Modal` titled with the path, `useContextDocument`, `DocumentContent`, the `attach.tokens` figure, and `attach.loadError` when the request fails.
Skills: `frontend-ui-architecture` → `placement.md § The component folder`, `§ Sub-component ownership`, `composition.md § Prop design`, `logic.md § The four kinds of state` (server state stays in the query cache; only the optimistic override is local). `react-best-practices` → `SKILL.md § Derive, Don't Store`, `§ Key Prop Patterns` (key by path), `§ Accessibility`, `§ Component Design` (under 200 lines each). `react-testing-library` → `SKILL.md § Query Priority`, `§ userEvent`, `§ Async Testing`.
Tests to add: `AttachmentEditor.test.tsx` — `fetch` mocked, agent owner unless stated, each case following its `verify:` clause: AC-30, AC-31, AC-32, AC-33 (agent route), AC-34, AC-35, AC-36, AC-37, AC-38, AC-39, AC-41, AC-42, AC-43, AC-44, AC-82, NFR-5 (each control found by role and name, activated from the keyboard), NFR-6, NFR-11 and NFR-13 (no document request before a preview, no request while typing in the filter).
Done when: `.claude/agents/scripts/check-code.sh client -- AttachmentEditor` passes with the typecheck green.

### Stage 11 — The Context tab in the agent editor and in the skill editor
Track: client · After: 10
Files: `client/src/app/agents/[id]/_components/AgentEditor/{constants.ts,AgentEditor.tsx,AgentEditor.test.tsx}`, `…/AgentEditor/_components/ContextTab/{ContextTab.tsx,ContextTab.test.tsx,index.ts}` (New), `client/src/app/skills/constants.ts`, `client/src/app/skills/_components/SkillDetail/SkillDetail.tsx`, `…/SkillDetail/_components/ContextTab/{ContextTab.tsx,ContextTab.test.tsx,index.ts}` (New), `client/src/app/skills/_components/SkillDetailPane/SkillDetailPane.test.tsx`, `client/messages/en/agents.json`, `client/messages/en/skills.json`
Read first: `…/AgentEditor/AgentEditor.tsx`, `constants.ts`, `AgentEditor.test.tsx` — the tab list and the hook mocks; `client/src/app/agents/[id]/page.tsx:25-30` — `tab` from the URL; `client/src/app/skills/constants.ts:16-24`, `…/SkillDetail/SkillDetail.tsx:86-98`; `client/src/app/skills/helpers.ts:40-50`; `…/SkillDetailPane/SkillDetailPane.test.tsx` — navigation mocks; `i/img_1.png`, `i/img_2.png`.
Steps:
1. Agent: add `{ key: "context", labelKey: "editor.tabs.context", icon: "Folder" }` to `TABS` after `skills`; add `editor.tabs.context: "Context"` to `agents.json`; render `<ContextTab key={agent.id} agent={agent} />` for `tab === "context"`.
2. Agent `ContextTab`: `useAttachments({ kind: "agent", id })`, then in order:
   - the heading `agentTab.title`;
   - the badge `agentTab.count` with `paths.length` and `documents.length`;
   - the hint;
   - `<AttachmentEditor state preview="button" />`;
   - a footer with `attach.tokens` from `sumTokens` (own and inherited documents that are in the list) and the note `agentTab.note`.
3. Skill: add `{ key: "context", labelKey: "detail.tabs.context", icon: "Folder" }` to `SKILL_TABS` after `config`; add `detail.tabs.context: "Context"` to `skills.json`; render `<ContextTab key={skill.id} skill={skill} />`.
4. Skill `ContextTab`: `useAttachments({ kind: "skill", id })`, then in order:
   - the heading `skillTab.title`;
   - the badge `skillTab.count`;
   - the line `skillTab.inherit`;
   - `<AttachmentEditor state preview="icon" />`;
   - `attach.tokens`;
   - while at least one path is attached, the label `skillTab.serializesAs` over a read-only `<pre>` holding `skillTab.serializedHeading` and one `- <path>` line per attached path in order.
Skills: `frontend-ui-architecture` → `placement.md § Components` (each tab under the single parent that renders it), `devdigest.md` (the namespace is the feature area: tab labels in `agents` / `skills`, the tab body in `context`). `react-best-practices` → `SKILL.md § Component Design`, `§ Over-Engineering` (two thin tabs, no flag-driven third component). `react-testing-library` → `SKILL.md § Query Priority`, `§ Mocking Strategies`.
Tests to add:
- Agent `ContextTab.test.tsx`: AC-40 ("2 of 7 attached"), AC-51 ("≈ 317 tokens", "≈ 1,240 tokens"), AC-52, AC-84 ("≈ 407 tokens").
- Skill `ContextTab.test.tsx`: AC-53, AC-54, AC-57, and AC-33 for `PUT /skills/:id/context`.
- `AgentEditor.test.tsx`: the Context tab is third, a click calls `onTab("context")`, `tab="context"` shows the heading (AC-81, AC-29).
- `SkillDetailPane.test.tsx`: the tab is second, a click replaces the URL with `tab=context`, `?tab=context` shows the heading (AC-81, AC-29).
- Every test renders through the catalog (NFR-7).
Done when: `.claude/agents/scripts/check-code.sh client` passes.

### Stage 12 — The trace drawer
Track: client · After: 11
Files: `…/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`, `…/RunTraceDrawer/_components/SpecsRead/{SpecsRead.tsx,index.ts}` (New), `…/RunTraceDrawer/RunTraceDrawer.test.tsx`, `client/messages/en/runs.json` (the folder is `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer`)
Read first: `…/TraceBody/TraceBody.tsx:36-52`, `:74-95`; `…/RunTraceDrawer/styles.ts:95-100`; `…/RunTraceDrawer/RunTraceDrawer.test.tsx` (whole); `client/messages/en/runs.json:31-59`; `i/img_3.png` — the two rows that change, nothing else of the frame (NG-9).
Steps:
1. `runs.json`: `trace.prompt.specs` → "Project context — attached specs (untrusted)"; add `trace.config.specTokens` "≈ {count, number} tok", `trace.config.specFromAgent` "agent", `trace.config.specViaSkill` "via {skill}".
2. `SpecsRead({ trace })`: the entries are `trace.specs_docs`, or `trace.specs_read` mapped to path-only entries when the key is absent. With none, render `trace.config.none`. Per entry render plain spans: the path, then `specTokens` when `tokens` is present, then `specViaSkill` for `source === "skill"` or `specFromAgent` for `source === "agent"`, and nothing for an entry without `source`.
3. `TraceBody`: replace the inline list with `<SpecsRead trace={trace} />`. The prompt row is otherwise unchanged.
Skills: `frontend-ui-architecture` → `placement.md § Sub-component ownership`. `react-best-practices` → `SKILL.md § Conditional Rendering`, `§ Key Prop Patterns`. `react-testing-library` → `SKILL.md § Query Priority`, `§ Asserting absence`.
Tests to add: `RunTraceDrawer.test.tsx`:
- two `specs_docs` entries render two paths, each with its "≈ N tok" (AC-77);
- no `specs_docs` key and an empty `specs_read` render "none" (AC-78);
- the labelled row is present when `prompt_assembly.specs` holds text and absent when it is null (AC-79);
- the expanded row and the full-screen view hold the whole text (AC-80);
- a `skill` entry renders the skill's name; an entry without `source` renders path and tokens only (AC-87).
Done when: `.claude/agents/scripts/check-code.sh client -- RunTraceDrawer` passes, then `.claude/agents/scripts/check-code.sh client` whole.

## 5. Skills matrix
| Stage | onion-architecture | fastify-best-practices | drizzle-orm-patterns | postgresql-table-design | zod | security | typescript-expert | frontend-ui-architecture | react-best-practices | next-best-practices | react-testing-library |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `rules/zod-contracts.md`, `rules/ports-and-di.md` | — | — | — | `references/object-pick-omit.md`, `object-optional-vs-nullable.md`, `schema-string-validations.md` | — | — | — | — | — | — |
| 2 | `rules/domain-purity.md`, `rules/testing.md` | — | — | — | — | `SKILL.md § Agentic AI Security` | `SKILL.md § Code Review Checklist` | — | — | — | — |
| 3 | `rules/drizzle-persistence.md`, `rules/zod-contracts.md` | — | `references/schema-definition.md`, `references/migrations.md` | `SKILL.md § Constraints, § Indexing` | — | — | — | — | — | — | — |
| 4 | `rules/ports-and-di.md`, `rules/layers.md` | — | — | — | — | `SKILL.md § File Upload Security` | — | — | — | — | — |
| 5 | `rules/layers.md`, `rules/fastify-transport.md`, `rules/drizzle-persistence.md`, `rules/ports-and-di.md`, `rules/testing.md` | `rules/routes.md`, `rules/testing.md` | `references/queries-joins-aggregations.md`, `references/transactions.md` | — | `references/parse-validate-early.md` | `SKILL.md § A01, § File Upload Security` | — | — | — | — | — |
| 6 | `rules/ports-and-di.md`, `rules/testing.md` | `rules/testing.md` | — | — | — | `SKILL.md § A09` | — | — | — | — | — |
| 7 | — | — | — | — | — | `SKILL.md § A05` | — | `placement.md`, `devdigest.md` | `SKILL.md § Component Design, § Accessibility` | — | `SKILL.md § Query Priority` |
| 8 | — | — | — | — | — | — | — | `placement.md`, `devdigest.md`, `logic.md` | `SKILL.md § Derive, Don't Store` | `file-conventions.md`, `rsc-boundaries.md`, `suspense-boundaries.md` | `SKILL.md § Async Testing` |
| 9 | — | — | — | — | — | — | — | `logic.md` | `SKILL.md § Hooks` | — | `SKILL.md § Hook Testing, § Timers` |
| 10 | — | — | — | — | — | — | — | `placement.md`, `composition.md`, `logic.md` | `SKILL.md § Key Prop Patterns, § Accessibility` | — | `SKILL.md § userEvent` |
| 11 | — | — | — | — | — | — | — | `placement.md`, `devdigest.md` | `SKILL.md § Over-Engineering` | — | `SKILL.md § Mocking Strategies` |
| 12 | — | — | — | — | — | — | — | `placement.md` | `SKILL.md § Conditional Rendering` | — | `SKILL.md § Asserting absence` |

## 6. Verification
| Package | Command (from the repository root) | Proves |
|---|---|---|
| server | `.claude/agents/scripts/check-code.sh server` | typecheck, layering (`depcruise`), unit lane — AC-2, 3, 4, 5, 47, 50, 63, 69, NFR-8, NFR-9 |
| server | `.claude/agents/scripts/check-code.sh --it server` (Docker) | the same, then the `.it` lane — AC-1, 6…9, 16, 45…49, 55, 56, 58…63, 68, 69, 72…76, 83, 86, NFR-1, 2, 3, 11, 12, 13. A SKIP proves nothing and is reported. |
| reviewer-core | `.claude/agents/scripts/check-code.sh reviewer-core` | its typecheck and tests, and the server typecheck that compiles it — AC-64…67, 70, 85, NFR-2 |
| client | `.claude/agents/scripts/check-code.sh client` | typecheck, component tests — AC-10…13, 15, 17…44, 51…54, 57, 77…82, 84, 87…92, NFR-4, 5, 6, 7 |
| mcp | `.claude/agents/scripts/check-code.sh mcp` | the untouched suite stays green — NFR-9, NG-8 |
| contracts | `diff -u server/src/vendor/shared/contracts/platform.ts client/src/vendor/shared/contracts/platform.ts` → nothing; the same for `trace.ts` → only the comment hunk present at `905cd86` | the two copies agree — NFR-9 |
| server | `cd server && ./node_modules/.bin/drizzle-kit generate` → "No schema changes, nothing to migrate" | the snapshot matches the schema; one migration, `0016` |
| client | `grep -rn "useReindexContext\|devdigest/specs\|chunks\|Re-index" client/src client/messages/en/context.json` → nothing | NFR-10 |
| client | `grep -rnE "^import \{" client/src/components/project-context "client/src/app/repos/[repoId]/context" \| grep "@devdigest/shared"` → nothing | only `import type` from the contracts (a value import would fail `next build`) |
| user | `cd server && pnpm db:migrate`, then the IN-2 scenario and one document with headings and a list | AC-71 and AC-14 (manual); the dev DB gains the two tables |

Not run by any agent: `./scripts/e2e.sh`, the dev stack, `next build`.

## 7. Risks and open questions
- [settled 2026-10-04] Execution mode — multi-agent (question 1). Chosen by the calling session under the user's delegation quoted in the spec's IN-12.
- [settled 2026-10-04] A `paths` body that repeats a path — answer 422 and leave the stored list unchanged (question 2), the option the stages assume. Chosen by the calling session under the same delegation.
- [non-blocking] The roots setting is the environment variable `PROJECT_CONTEXT_ROOTS`, a comma-separated list of folder names. IN-12 fixes "a server environment setting that lists root folder names", not its name.
- [non-blocking] A directory that is a symbolic link is not descended into (no cycle, nothing outside the clone); a `.md` file link is listed only when it resolves inside the clone. The spec covers only links that resolve outside (`spec:168`).
- [non-blocking] Only a lower-case `.md` suffix counts, as the glob of AC-2 reads.
- [non-blocking] A listed file that cannot be read keeps its entry with `tokens` 0; a run skips it (AC-69).
- [non-blocking] `specs_docs[].source` is optional in the schema, so the entry without `source` that AC-87 renders is a valid trace; the server always writes it (AC-86).
- [non-blocking] `?path=` present but empty answers 404 (not in the list); an absent `path` answers 422, as the contract block words it (`spec:299-301`).
- [non-blocking] A row for a path that is not in the list shows no type badge and no Preview control — there is nothing to preview. A failed Preview request shows an error inside the dialog (MI-2).
- [non-blocking] The refresh control stays disabled until an index state has been read, as `useBlastResync` does (`client/src/lib/hooks/blast.ts:64-66`). AC-89 needs the value "read before the resync request".
- [non-blocking] Selecting a document pushes a history entry; the default selection writes nothing to the URL.
- [non-blocking] The label escaping in `wrapUntrusted` also reaches the intent prompt's `doc:<path>` label (`server/src/modules/intent/render.ts:54`). Its output changes only for a path holding `"`, `<`, `>` or a line break.
- [non-blocking] `GET /repos/:id/context` reads every listed file to count characters (AC-50), on every request and at every run start. Fine for hundreds of files (NFR-13); see REC5.
- [non-blocking] Until the user runs `cd server && pnpm db:migrate`, the attachment routes and `agent_count` fail on the dev stack with `relation "agent_context_docs" does not exist`. The integration tests migrate their own database.
- [non-blocking] Not checked by this plan or by any brief: the e2e flows that open the agent and skill editors (`e2e/specs/03-agents.flow.json`, `08-skills.flow.json`, `09-agent-skills.flow.json`). A new tab and a new sidebar item are additive, but nothing runs them.
- [non-blocking] Root `INSIGHTS.md` is shared by both tracks: see §9.
- Not checked while planning: `route-skills.sh` was not run on the impact map (most files are new); the lanes were taken from `rules/routing.md` by reading. No test or typecheck was run.

## 8. Handoff to reviewers
- Architecture:
  - A new port `RepoDocsReader` in the server copy of `adapters.ts` only, with `FsRepoDocsReader` and a mock.
  - `ContextDeps` with six entries (one is a config value).
  - `ContextRepository` reads `agents`, `agent_skills` and `skills` for `usage` and `linkedSkillPaths`.
  - The replace is a delete and an insert inside `db.transaction` in the repository, as `server/src/modules/skills/repository.ts:137`, `:198` do, where `rules/drizzle-persistence.md` prefers a unit-of-work port the tree does not have.
  - `ProjectContextResolver` restated in `reviews/deps.ts`.
  - The client cross-route folder `components/project-context/` with PascalCase sub-folders (precedent: `components/diff-viewer/`).
  - `hooks/core.ts` imports `RESYNC_POLL_TIMEOUT_MS` from `hooks/blast.ts`.
  - Inline `styles.ts` styling rather than Tailwind utilities.
- Security:
  - Six new routes.
  - The `path` query and the stored `paths` both reach a filesystem read. The guard is membership in the walked list plus `realpath` containment in the adapter.
  - Symbolic links.
  - Repository-controlled file names enter the `<untrusted source="…">` label — escaped in Stage 2 — and the Live Log lines.
  - Document text reaches the model only inside `<untrusted>` under the new trusted rule, and reaches the browser through the Markdown primitive: no raw HTML; a Markdown image still loads from its remote URL, as NFR-4 accepts.
  - No size ceiling on a document or on the list (NFR-12, NFR-13).
  - The page now calls `POST /repos/:id/resync`, which enqueues for any repository id without a workspace check (`server/src/modules/repo-intel/routes.ts:47-55`; see REC6).

## 9. Execution
Mode: multi-agent
Recommended: multi-agent — after Stage 1 the server chain and the client chain share no file, each is five or six stages of real work, and the client's tests mock `fetch`.
| Track | Stages | Write set | After | Runs |
|---|---|---|---|---|
| shared | 1 | `server/src/vendor/shared/**`, `client/src/vendor/shared/**`, `server/test/contracts.test.ts` | — | alone |
| server | 2–6 | `reviewer-core/src/**`, `reviewer-core/test/**`, `server/src/db/**`, `server/src/platform/{config,container}.ts`, `server/.env.example`, `server/src/adapters/{docs/**,mocks.ts,index.ts}`, `server/src/modules/context/**`, `server/src/modules/index.ts`, `server/src/modules/reviews/{deps,run-executor}.ts`, `server/test/{prompt-callers,prompt-structured,config-context-roots,context-discovery,context-service,prompt-log}.test.ts`, `server/test/{context,reviews-context}.it.test.ts` | shared | parallel |
| client | 7–12 | `client/src/lib/**`, `client/messages/en/{context,runs,agents,skills}.json`, `client/src/vendor/ui/{nav.ts,styles.css}`, `client/src/components/{project-context/**,app-shell/navigation.test.tsx}`, `client/src/app/repos/[repoId]/context/**`, `client/src/app/agents/[id]/_components/AgentEditor/**`, `client/src/app/skills/{constants.ts,_components/SkillDetail/**,_components/SkillDetailPane/SkillDetailPane.test.tsx}`, `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**` | shared | parallel |

Stage 2 opens the server track because the server typecheck compiles `reviewer-core/src`; the client track never does. `INSIGHTS.md`: a server brief appends only to `server/INSIGHTS.md` or `reviewer-core/INSIGHTS.md`, a client brief only to `client/INSIGHTS.md`. An entry meant for the root file goes into the brief's report, and the calling session records it once both tracks are done.

Briefs — one or two stages each, a fresh `implementer` per brief, in order inside a track:
- shared · stage 1 → "Execute stage 1 of specs/2026-10-04-project-context-plan.md (track shared). Write only inside: server/src/vendor/shared/**, client/src/vendor/shared/**, server/test/contracts.test.ts. Check with: .claude/agents/scripts/check-code.sh --no-tests server client reviewer-core, then .claude/agents/scripts/check-code.sh server -- test/contracts.test.ts, and the two diff -u commands of the stage."
- server · stage 2 → "Execute stage 2 of specs/2026-10-04-project-context-plan.md (track server). Write only inside: reviewer-core/src/**, reviewer-core/test/**, server/test/prompt-callers.test.ts, server/test/prompt-structured.test.ts. Check with: .claude/agents/scripts/check-code.sh reviewer-core, then .claude/agents/scripts/check-code.sh server -- test/prompt-callers.test.ts test/prompt-structured.test.ts."
- server · stages 3–4 → "Execute stages 3–4 of specs/2026-10-04-project-context-plan.md (track server). Write only inside: server/src/db/schema/{agents,skills}.ts, server/src/db/schema.ts, server/src/db/migrations/** (through `pnpm db:generate` only — never applied), server/src/platform/config.ts, server/.env.example, server/src/adapters/{docs/**,mocks.ts,index.ts}, server/src/modules/context/{helpers,constants}.ts, server/test/{config-context-roots,context-discovery}.test.ts. Check with: .claude/agents/scripts/check-code.sh server."
- server · stage 5 → "Execute stage 5 of specs/2026-10-04-project-context-plan.md (track server). Write only inside: server/src/modules/context/**, server/src/modules/index.ts, server/src/platform/container.ts, server/test/context-service.test.ts, server/test/context.it.test.ts. Check with: .claude/agents/scripts/check-code.sh server, then .claude/agents/scripts/check-code.sh server -- test/context.it.test.ts."
- server · stage 6 → "Execute stage 6 of specs/2026-10-04-project-context-plan.md (track server). Write only inside: server/src/modules/reviews/{deps,run-executor}.ts, server/test/reviews-context.it.test.ts, server/test/prompt-log.test.ts. Check with: .claude/agents/scripts/check-code.sh --it server."
- client · stage 7 → "Execute stage 7 of specs/2026-10-04-project-context-plan.md (track client). Write only inside: client/src/lib/hooks/{core,agents,skills}.ts, client/src/lib/types.ts, client/messages/en/context.json, client/src/vendor/ui/{nav.ts,styles.css}, client/src/components/project-context/**, client/src/components/app-shell/navigation.test.tsx. Check with: .claude/agents/scripts/check-code.sh client."
- client · stages 8–9 → "Execute stages 8–9 of specs/2026-10-04-project-context-plan.md (track client). Write only inside: client/src/app/repos/[repoId]/context/**, client/src/lib/hooks/core.ts, client/src/lib/hooks/core.test.tsx. Design: i/img.png. Check with: .claude/agents/scripts/check-code.sh client."
- client · stage 10 → "Execute stage 10 of specs/2026-10-04-project-context-plan.md (track client). Write only inside: client/src/components/project-context/**. Design: i/img_1.png, i/img_2.png. Check with: .claude/agents/scripts/check-code.sh client."
- client · stages 11–12 → "Execute stages 11–12 of specs/2026-10-04-project-context-plan.md (track client). Write only inside: client/src/app/agents/[id]/_components/AgentEditor/**, client/src/app/skills/constants.ts, client/src/app/skills/_components/SkillDetail/**, client/src/app/skills/_components/SkillDetailPane/SkillDetailPane.test.tsx, client/messages/en/{agents,skills,runs}.json, client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**. Design: i/img_1.png, i/img_2.png, i/img_3.png. Check with: .claude/agents/scripts/check-code.sh client."

single-agent: the same briefs, one after another, 1 → 12; the Runs column is not used.

## 10. Recommendations — not applied
- REC1 [requirements] Also neutralise an opening-delimiter lookalike (`<untrusted`) inside document text — why: `reviewer-core/src/prompt.ts:32` escapes only the closing tag, and AC-66's `verify:` exercises only the closing tag and the label; a document can still show the model a second, fake opening tag — would change: Stage 2 (one more replace in `wrapUntrusted`, one test), and the bytes of every untrusted block that happens to hold that text.
- REC2 [approach] One resync-wait hook in `client/src/lib/hooks/repo-intel.ts` used by Blast Radius and by the page, instead of a second copy of the wait — why: Stage 9 repeats the logic of `client/src/lib/hooks/blast.ts:37-72` and imports its timeout constant across areas — would change: Stage 9, plus `blast.ts` and `blast.test.tsx` (its module mock replaces `./repo-intel` whole).
- REC3 [approach] Put the heading and list styles on `.dd-md` itself, not under `.dd-doc` — why: `client/INSIGHTS.md § Open Questions` (2026-09-23) suspects the same defect on the skill Preview tab, which this plan leaves as it is — would change: the selector in Stage 7; it also restyles Markdown in finding cards and PR comments (`FindingCard.tsx:80`, `CommentCard.tsx:31`).
- REC4 [scope] Remove or guard `GitClient.readFile` in a separate change — why: `server/src/adapters/git/simple-git.ts:154-156` joins any path onto the clone directory unchecked, and no module calls it (`grep -rn "\.readFile(" server/src/modules` finds only `node:fs` reads) — would change: nothing here; this plan does not use it.
- REC5 [requirements] Let the list take `tokens` from a cache keyed by path, size and mtime — why: AC-50 forces a full read of every listed file on each list request and each run start — would change: Stage 5 (`listDocuments`), one cache in the adapter.
- REC6 [scope] Check the repository's workspace in `POST /repos/:id/resync` and `GET /repos/:id/index-state` — why: `server/src/modules/repo-intel/routes.ts:38-55` resolves the workspace but never looks the repository up in it, and a second screen now calls both — would change: nothing here; a separate change in `repo-intel`.
