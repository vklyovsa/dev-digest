# Retro — how multi-agent runs went

A ledger of retrospectives: one entry per multi-agent run, recording what the run cost,
where the agents struggled, what was duplicated or missed, and what was proposed in
response. It is about the **workflow** — agents, briefs, handoffs, rounds. A fact about the
code goes to `../../INSIGHTS.md`; a spec or a plan stays in `../../specs/`.

## How an entry is made

Only by the `workflow-retro` skill, and only when the user types `/workflow-retro`
(`../../.claude/skills/workflow-retro/SKILL.md`). Nothing starts it automatically: the
skill is `disable-model-invocation: true`, and no agent, command or hook calls it.

- `/workflow-retro` — works from what the session already holds.
- `/workflow-retro deep` — also measures the session transcripts: real token sums per
  agent and per model, where the time went, context sizes, tool errors, what each agent
  read against what its brief named, files read by many agents.

The skill proposes changes and applies none. An entry is checked before it is reported:

```bash
node .claude/skills/workflow-retro/scripts/ledger.mjs check docs/retro/ledger/<entry>.md
```

## Layout

```
docs/retro/
  README.md                      this file
  ledger/
    <YYYY-MM-DD>-<run-slug>.md   one entry per run, never edited afterwards
```

The ledger is append-only. A proposal that was applied, rejected or proved useless is
recorded in the **next** entry's "Earlier proposals", not by editing the old one.

## Reading it

Across entries — runs side by side, tokens per unit of result, findings by kind and by
module, the files proposals keep pointing at, and what came back:

```bash
node .claude/skills/workflow-retro/scripts/ledger.mjs trend
```

One entry follows `../../.claude/skills/workflow-retro/ledger-template.md`, and its lines
are written to be searched:

| To see | Run |
|---|---|
| everything said about one agent | `grep -rn "\[implementer\]" docs/retro/ledger/` |
| one kind of problem | `grep -rn "\] duplication —" docs/retro/ledger/` |
| every proposal for one file | `grep -rn "→ \`.claude/agents/implementer.md\`" docs/retro/ledger/` |
| what keeps coming back | `grep -rn "recurring ×\|it recurred" docs/retro/ledger/` |

- **Module** — the part of the workflow a finding is about: an agent type,
  `calling-session`, `spec`, `plan`, `command:<name>`, `script:<name>`, `skill:<name>`,
  `harness`.
- **Kind** — `cost`, `friction`, `ease`, `duplication`, `miss`, `wrong-claim`, `handoff`,
  `question`, `rework`, `human-load`, `conduct`.
- **Final context** in a launch table is the size of an agent's context at its last call,
  not its spend. Spend is in `Tokens:` and in the Measurements of a `deep` entry.
- **Units** — the stages of the plan, the criteria done out of the total, the files
  changed. They are what makes a small run and a large one comparable.

## Before changing an agent, a command or the pipeline

Read what the ledger says about it first, and open the proposals aimed at that file. A
proposal marked `recurring ×N` has been observed in N runs; one marked
`applied — it recurred` did not work and needs a different fix.
