# Intent layer — spec (L03)

Before any reviewer agent runs, the review knows why the PR exists.
Packages: **server**, **reviewer-core**, **client** (contract change lands in both
`vendor/shared` copies). `e2e` is untouched.
Plan: [`intent-layer-plan.md`](intent-layer-plan.md). How it works once built:
`server/docs/intent-in-prompt.md`, `server/docs/prompt-logging.md`.

## Goal

A PR's intent — one sentence, what is in and out of scope, a few risk areas — is
derived by a separate cheap model from the author's own text (title, body, linked
spec/plan docs, same-repo issues), or, when those are missing, from indirect data
(branch, commits, changed files, labels). Its confidence is computed in code, it is
cached by the content of its sources, it is shown on the Overview tab, and it reaches
every agent's prompt as an untrusted block — so an agent can check that the diff does
what it claims and notice changes outside the stated scope.

## Non-goals

- No derivation at import, list sync, polling or PR-page open — only at review time
  or on the Derive button.
- No Jira / Linear / Notion / Confluence integration, no fetching of arbitrary URLs,
  no issues from other repositories.
- No `scope_relation` on findings and no change to the findings table: scope handling
  is prompt-only.
- No structured Risk Brief — `risk_areas` are short strings; anchored risks are L05.
- Intent cost is not added to the agent run's cost, the trace stats or the PR list
  COST column.
- No per-agent intent toggle, no seed change, no new e2e flow, no redesign of the
  Settings model picker. `PrDetail.linked_issue` keeps its current behaviour.

## Behaviour and acceptance criteria

### B1 — Sources

- **Title and body.** The body is capped at 6 000 chars before any regex or model
  sees it.
- **Linked docs**, up to 3: repo-relative paths and same-repo
  `github.com/<owner>/<repo>/blob/<ref>/<path>` URLs with a prose extension
  (`md`, `mdx`, `markdown`, `txt`, `rst`, `adoc`). Read at the PR's `head_sha`, never
  from the clone's working tree: on a miss the PR head is fetched once, a file the PR
  itself adds falls back to its patch, otherwise the doc is `unresolved` with a reason.
  Paths with `..`, absolute paths and other extensions are never read.
- **Issues**, up to 3 same-repo references — closing keywords, `#N`,
  `<owner>/<repo>#N`, issue URLs — fetched through GitHub. The PR's own number is
  skipped.
- **Unresolved, never fetched:** cross-repo issues, ticket keys (`PAY-12`; `UTF-8`,
  `RFC-…` and similar acronyms are not tickets) and external URLs. Stored URLs lose
  their query string and fragment.
- **Indirect data** — branch, commit subjects, changed files with `+/−`, labels — is
  always collected. PR labels are now stored on `pull_requests` when PR detail loads.
- Every source is recorded as `used` / `unresolved` / `truncated`, with a note.

### B2 — Confidence (code, never the model)

- `high` — a linked doc is used or truncated, or a used issue plus a substantive body.
- `medium` — a substantive body, or a used issue.
- `low` — anything else.
- A body is substantive with ≥ 8 words once HTML comments, headings, empty checklist
  items and link-only lines are stripped — an untouched PR template reads `low`.

### B3 — Derivation and cache

- One structured call through the `review_intent` feature model. Default
  `openrouter` / `deepseek/deepseek-v4-flash` in all three registry copies; a
  Settings → Models override applies to the next derivation and is recorded as the
  intent's `provider` / `model`.
- Model output is trimmed and capped in code: ≤ 8 items per scope list, ≤ 5 risk
  areas, intent ≤ 500 chars. `out_of_scope` stays empty unless a source excludes
  something.
- The cache key hashes the sources as used, the system template, provider/model and a
  derivation version — not the raw `head_sha`. A review with unchanged sources reuses
  the stored intent with no model call; a changed doc, body or model re-derives; the
  Derive button always re-derives.
- In a review, a partially unavailable collection (git or GitHub down) with a stored
  intent reuses the stored one — an outage never overwrites a better intent.
- The call's tokens and cost are stored on `pr_intent`.

### B4 — Review integration

- Resolved once per review click, before the agents, shared by every queued run;
  a review never waits more than 90 s for it.
- Ready → each prompt gets `## PR intent (derived)` right after `## PR description`:
  a trusted rule, then the block inside `<untrusted source="intent">` (≤ 4 000 chars).
  `run_traces.trace.prompt_assembly.intent` carries it; the trace drawer shows it.
- The trusted rule: intent never lowers a finding's severity or removes a finding; a
  defect outside the declared scope is reported at its true severity, and the
  rationale says it falls outside the stated scope.
- Missing key, model error or timeout → the review still finishes `done`, without the
  section. The Live Log gets an `info` line, never `error` — no toast per queued run.
- The agent run's `tokens_*` and `cost_usd` exclude the intent call.

### B5 — Live Log

Every queued run shows `Resolving PR intent…`, the sources line (used · unresolved),
then either `Intent reused (no model call) — confidence X` or
`Intent derived with <provider>/<model> — confidence X · in→out tok · $cost`, or
`Intent unavailable — reviewing without it: <reason>`. Each agent adds
`Intent in prompt (confidence X)` or `No intent — the prompt carries no intent section`.
PR text and doc contents are never logged — only paths and counts.

### B6 — API and contracts

- `GET /pulls/:id/intent` → `{ intent: PrIntentRecord | null }` with `stale` (head
  commit, title or body changed since derivation). Never calls a model.
- `POST /pulls/:id/intent/derive` → re-derives; 3 requests / minute; 400
  `intent_model_unavailable` without a provider key, 502 when the model fails or
  times out.
- Both are workspace-scoped (404 outside it) and return 422 for a non-uuid id.
- `IntentSource`, `IntentConfidence`, `IntentDerivation`, `PrIntentRecord`,
  `PrIntentResponse`, `PrDetail.labels`, `PromptAssembly.intent` and
  `GitClient.readFileAt` land in both `vendor/shared` copies. Earlier `RunTrace` and
  `Intent` payloads still parse.

### B7 — Intent card (Overview tab)

- Above Description: the intent as a quote; IN SCOPE / OUT OF SCOPE; RISK AREAS chips;
  a confidence badge; "Derived from" with unresolved references and their notes;
  low-confidence and stale notices; Derive / Re-derive; model · tokens · cost · head sha.
- Before any derivation: an empty state with a Derive button. A derive error shows
  inline with the API message.
- Model output renders as plain text only — no markdown, no links.

### B8 — Prompt-assembly logging

One pino line `prompt.assembled` per prompt sent to a model (every agent chunk and the
intent call), sharing one `correlationId` per review click: section names, sources,
whether each is wrapped, sizes — never text. `PROMPT_LOG=off|summary|verbose`;
`verbose` is honoured only with `NODE_ENV=development`.

## Affected packages and files

**server**

- `src/modules/intent/*` (new; owns `pr_intent`), `src/prompts/intent.system.md`
- `src/modules/reviews/{deps,run-executor,constants}.ts` — the intent step
- `src/modules/pulls/*`, `src/adapters/github/octokit.ts` — labels
- `src/adapters/git/simple-git.ts` — `readFileAt`, `fetchPullHead`; `src/adapters/mocks.ts`
- `src/db/schema/{reviews,pulls}.ts`, migration `0015_intent_layer.sql` (columns only)
- `src/platform/{container,config,prompt-log}.ts`
- `src/vendor/shared/{adapters.ts,contracts/{brief,review-api,platform,trace}.ts}`

**reviewer-core** — `src/prompt.ts` (intent slot + trusted rule),
`src/review/run.ts` (`ReviewInput.intent`).

**client**

- `src/lib/hooks/intent.ts`, `.../OverviewTab/_components/IntentCard/`
- `.../RunTraceDrawer/` — the intent prompt block
- `src/lib/feature-models.ts`, `messages/en/{brief,runs}.json`
- `src/vendor/shared/{adapters.ts,contracts/{brief,review-api,platform,trace}.ts}`

## Operational note

`./scripts/dev.sh` applies `0015` on the next start; an API started on its own needs
`cd server && pnpm db:migrate` first, or `pr_intent` / `pull_requests` reads fail with
`column ... does not exist`.

## Open questions

- **Tests deferred** (iteration 1, decision 2026-09-27): no intent-specific suites yet —
  the list is in the plan, Stages 4–8. Existing review tests only got mock secrets and
  GitHub so they cannot reach real providers.
- **Cross-repo issues** stay unfetched (`FETCH_CROSS_REPO_ISSUES = false`). Flip it only
  if sending a private issue's text to the LLM provider is acceptable.
- **No silent model fallback**: without an OpenRouter key intent is unavailable with a
  Settings hint; the picker is OpenRouter-only.
- **`risk_areas` overlap the L05 Risk Brief** — L05 should replace the chips with
  anchored risks. Until then each chip is a focusable no-op `<button>`
  (`client/INSIGHTS.md`).
