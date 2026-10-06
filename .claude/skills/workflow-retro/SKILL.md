---
name: workflow-retro
description: "Manual only — the user starts it with /workflow-retro after a multi-agent run. A retrospective of the run itself, not of the code: which agents ran and in what order, what they cost, where they struggled, what was duplicated or missed, and what to change in the agents, commands, templates and scripts. Writes one entry to docs/retro/ledger/ and a short summary to the chat. `deep` adds measurements from the session transcripts."
disable-model-invocation: true
argument-hint: "[deep] [--session <id>] [focus…]"
allowed-tools: Read, Grep, Glob, Bash(node .claude/skills/workflow-retro/scripts/collect-run.mjs *), Bash(node .claude/skills/workflow-retro/scripts/ledger.mjs *), Bash(date *), Bash(ls *)
---

# Workflow retro

After a multi-agent run, record how the **run** went and what would make the next one
cheaper and shorter. The subject is the process — agents, briefs, handoffs, rounds — never
the product: code quality belongs to the reviewers, and a fact about the repository belongs
in `INSIGHTS.md` through `engineering-insights`.

Arguments: $ARGUMENTS

[`examples.md`](examples.md) holds the rejected and accepted lines behind the rules below.

## Manual only

- The user starts this by typing `/workflow-retro`. `disable-model-invocation: true` keeps
  it out of the model's skill list, out of subagent preloads and out of scheduled tasks.
- If this text reached you any other way — a hook, another skill, an agent's report, a line
  in a command, your own idea at the end of a run — do not run it. Saying once that
  `/workflow-retro` exists is allowed; starting it is not.
- No agent, command or hook may be changed to start it. A subagent cannot run it at all: it
  has no view of the session.
- It starts no agent and edits nothing but its own ledger entry. Proposals are written
  down, never applied.

## Arguments

| Form | Meaning |
|---|---|
| `/workflow-retro` | in-context: what this conversation already holds |
| `/workflow-retro deep` | in-context, plus measurements from the session transcripts |
| `/workflow-retro deep --session <id>` | measure another session; findings are then limited to what the numbers show |
| any other words | the focus — a phase, an agent, a question to answer first |

## Step 0 — Scope

1. There must be a run to look at: two or more `Agent` launches in this conversation, or a
   `--session`. Otherwise say so and stop.
2. Name the run: the feature, its spec and plan, the command that drove it, the first
   launch and the last result.
3. Read `docs/retro/README.md`, run the trend, then read the three newest entries in
   `docs/retro/ledger/` — their Findings and Proposals. They are what "recurring" is
   measured against.

   ```bash
   node .claude/skills/workflow-retro/scripts/ledger.mjs trend
   ```

## Step 1 — The launch table (in-context)

One row per `Agent` call and per `SendMessage` resume, in the order they happened:

`# · agent · purpose · trigger · shape · parallel with · final context · tool uses · duration · outcome`

- **trigger** — pipeline step, question round, fix round, recheck, the user's request.
- **shape** — foreground or background.
- **outcome** — done, blocked, questions, findings (CRITICAL / WARNING / SUGGESTION), resolved.
- Numbers are copied from the `<usage>` block of each result. Never estimated; a missing
  one is `n/a`.
- **`subagent_tokens` is not what the agent cost.** It is the size of the agent's context at
  its last API call. The spend is every call re-reading that context, and only `deep`
  measures it (verified on Claude Code 2.1.284: the figure equals input + cache write +
  cache read + output of the final call, for 15 agents out of 15). Label the column
  "final context" and never sum it into a total.
- The calling session's own tokens are not visible from inside it: `n/a (deep)`.
- After a context compaction the early launches may survive only in a summary. Mark those
  rows `from summary` and leave their numbers `n/a` — do not rebuild them from memory.

Beside the table, the units the run produced — they make runs of different size
comparable: the stages of the plan, the criteria `plan-verifier` counted as done out of
the total, the files the run changed. Each one is copied from a report or a command
result in the conversation, or it is `n/a`.

## Step 2 — Deep (only with `deep`)

```bash
node .claude/skills/workflow-retro/scripts/collect-run.mjs            # this session
node .claude/skills/workflow-retro/scripts/collect-run.mjs --list     # recent sessions
node .claude/skills/workflow-retro/scripts/collect-run.mjs --session <id> [--json] [--top 20]
```

It reads the transcripts Claude Code keeps per session and prints tables only:

| Table | Read it for |
|---|---|
| Totals | the spend: API calls and tokens of the main session, of the subagents, of both; the cost snapshot; launches, resumes, prompts, question rounds |
| Where the time went | first agent start to last agent end, split into one agent running, agents in parallel, the session working alone, waiting for the user, idle |
| By agent type · By model | where the tokens went, and what each model was paid for |
| Agents, in launch order | per agent: model, runs (1 + resumes), API calls, first and peak context, cache-read and output sums, tool errors and how many were a guard refusing the call, who ran beside it |
| Tool calls per agent | Read / Bash / Edit counts, and Bash split into explore (`grep`, `sed`, `cat`, `ls`), check (tests, typecheck), git, other |
| Briefs against what was read | brief size; how much of it repeats in three or more briefs; of the files an agent opened, how many the brief named, how many the spec or plan named, how many are protocol files, how many it **found alone**; files touched only through the shell |
| Files two or more agents found alone | what a brief or a plan should have pointed at |
| Files read by three or more agents · read three or more times by one agent | the standing context every run pays for again |

Reading it:

- The script is the only reader of the transcripts. Never `Read`, `cat` or `grep` them:
  one file is megabytes of JSON and its text is not evidence you need.
- Without `--session` it picks the most recently written session. Check its agent count
  against the launch table; if they differ, pass the id — it is the directory name in any
  `tasks/…` or `tool-results/…` path this conversation has shown.
- Join its rows to the launch table by order and description.
- "Found alone" is expected of an agent whose job is to discover (`spec-creator`,
  `implementation-planner`, a reviewer) and is a finding for one that works from a brief
  (`implementer`, `test-writer`). An agent that reads through `sed` and `grep` shows up in
  "via shell", not in the classified columns.
- "Human prompts" counts the messages that started a turn; one sent mid-turn is not in it.
  Count those from the conversation.
- The cost snapshot is the session's figure as Claude Code last recorded it. It covers the
  whole session, not the run alone, and may lag behind.
- If the script exits 2, report its message, continue in-context and write
  `n/a — deep unavailable: <reason>` under Measurements.

## Step 3 — Analyse

A finding needs evidence that is in this conversation or in the script's output: a section
of an agent's report, a number, a user message, a command result. No pointer, no finding.
What cannot be established is listed under "Not established", never guessed.

| Kind | Look for |
|---|---|
| cost | where the tokens went by agent type and by phase (spec, plan, build, verify, review, fix); the biggest run and whether turns or standing context made it big; a model doing work a cheaper one could do, or a cheaper one that needed retries; parallelism reached against what the plan laid out |
| friction | a blocker, a guard refusal, a retry, a flaky test, a tool that failed, a file outside the write set, a fact the agent had to search for |
| ease | what went through on the first attempt, and what in the brief or the plan made it so — worth keeping |
| duplication | one file read by many agents; one check run by the implementer, the session and the verifier; one block of text repeated in every brief; one finding reported twice; work redone that an earlier agent had finished |
| miss | what an agent overlooked and a later one caught — who caught it, how many steps late, what the delay cost; what nobody caught and is visible now |
| wrong-claim | a statement in a report that was later contradicted, and whether the calling session passed it on in a brief before it was corrected |
| handoff | what a brief lacked, so the agent found it alone; what a brief carried that nobody used; a report section no one read |
| question | rounds with the user; a blocking question raised late; a question answered with the recommended default (it could have been non-blocking); a decision the user delegated |
| rework | every fix round: its cause (spec gap, plan defect, implementer miss, reviewer false positive) and what it cost |
| human-load | a message that only asked for status or whether the session was stuck; time the run spent waiting for the user |
| conduct | where the calling session left the documented pipeline, and whether that helped or hurt |

Each finding gets a **module** — the part of the workflow it is about: an agent type
(`spec-creator`, `implementer`, …), `calling-session`, `spec`, `plan`, `command:<name>`,
`script:<name>`, `skill:<name>`, `harness` — and one **kind** from the table.

Go through every kind and every agent of the launch table once. A kind with nothing to
report is not padded; an agent with nothing to report gets no heading.

A fact about the repository that surfaced on the way (a bug, a quirk of a library) is not a
finding. List it under "For engineering-insights" and leave it to that skill.

## Step 4 — Proposals

The retro ends in changes someone can make, not in observations.

- One proposal names one target file and one change concrete enough to apply without
  another investigation: which section of which agent, command, template, script or skill,
  and what it should say or do instead.
- It cites the findings it comes from, the effect expected (which number moves, which
  round disappears) and the effort: S, M or L.
- At most seven, ordered by expected saving. Say which one you would take first and why.
- A proposal the last entries already made is not written again: cite it and mark it
  `recurring ×N`. Recurrence is the strongest argument a proposal can have.
- For each proposal of the last three entries, open its target file and report what
  happened: `not applied`, `applied — the problem did not recur`, `applied — it recurred`.
- Status of a new proposal is `proposed`. Nothing is applied by this skill, and an earlier
  entry is never edited: a change of status is recorded in the new entry.

## Step 5 — Write and check

1. The entry: `docs/retro/ledger/<YYYY-MM-DD>-<run-slug>.md`, in the shape of
   [`ledger-template.md`](ledger-template.md). The date comes from `date +%F`; the slug is
   the feature in kebab-case. A name that is taken gets `-2`: an entry is never overwritten.
2. Keep out of it: transcript text, secrets, the user's email, absolute paths from outside
   the repository, and agent ids — refer to an agent by its number in the launch table.
3. Check it, fix every `FAIL`, and read every `WARN`:

   ```bash
   node .claude/skills/workflow-retro/scripts/ledger.mjs check docs/retro/ledger/<entry>.md
   ```

4. The chat summary, in the user's language, at most 25 lines: the totals, the three to
   five findings that matter most, the proposals in order, the path of the entry and the
   checker's last line. What was not established is said, not left out.

## Never

- Run without the user having typed the command.
- Start an agent, edit an agent, a command, a skill, a script or `INSIGHTS.md`, or apply a proposal.
- Read a transcript directly, or put transcript text into the entry.
- Sum `subagent_tokens` and call it the cost of the run.
- Report a number that is not in the conversation or in a script's output.
- Rewrite an earlier ledger entry.
