# Retro: MCP server version from package.json

Date: 2026-10-17
Run: three plan stages built by two implementers, then plan-verifier and architecture-reviewer (the command that drove it is not established) · spec `mcp/specs/2026-10-17-server-version-from-package-json.md` · plan `mcp/specs/2026-10-17-server-version-from-package-json-plan.md` · branch `test/l08-sdd-plugin` @ `6a3da56`
Mode: deep
Totals: agents 4 · launches 4 · resumes 0 · fix rounds 0 · question rounds 0 · human prompts 1 · wall 0:02
Tokens: cache read 1.4M · cache write 273k · output 22k · cost snapshot $1.27
Units: stages 3 · criteria n/a · files changed n/a
Outcome: not established — the agents' reports were not read; no launch followed the verifier and the reviewer

Measured from another session (`--session a0c18b57-523a-4647-9a51-10487969131d`, 2026-10-17 10:30 → 10:33 UTC, Claude Code 2.1.295), so every finding rests on the script's numbers or on a file of the repository, never on a report. `stages 3` is the plan's `### Stage` headings. `fix rounds 0` is counted from the launch list: nothing started after #4. Tool uses in the launch table are the sums of the script's "Tool calls per agent" row.

## Launch table

| # | Agent | Purpose | Trigger | Shape | ∥ with | Final context | Tool uses | Duration | Outcome |
|---|---|---|---|---|---|---|---|---|---|
| 1 | implementer | Implement stages 1–2 | pipeline step (plan §9 brief) | bg | — | n/a | 28 | 0:45 | n/a |
| 2 | implementer | Implement stage 3 | pipeline step (plan §9 brief) | bg | — | n/a | 13 | 0:26 | n/a |
| 3 | plan-verifier | Verify diff against plan | pipeline step | bg | — | n/a | 6 | 0:32 | n/a |
| 4 | architecture-reviewer | Architecture review of diff | pipeline step | bg | — | n/a | 9 | 0:26 | n/a |

## Measurements

Source: transcripts · Claude Code 2.1.295 · 2m 50s session.

| Scope | API calls | Input | Cache write | Cache read | Output |
|---|---|---|---|---|---|
| main session | 13 | 26 | 54k | 698k | 4.2k |
| subagents (4) | 20 | 40 | 218k | 728k | 18k |
| all | 33 | 66 | 273k | 1.4M | 22k |

| Window UTC | Length | One agent running | Agents in parallel | Session working alone | Waiting for the user | Idle |
|---|---|---|---|---|---|---|
| 10:30:42 → 10:33:10 | 2m 28s | 2m 09s (88%) | 0s (0%) | 18s (12%) | 0s (0%) | 0s (0%) |

| Agent | Agents | API calls | Cache read Σ | Output Σ | Wall |
|---|---|---|---|---|---|
| implementer | 2 | 11 | 455k | 9.9k | 1m 11s |
| architecture-reviewer | 1 | 5 | 172k | 3.0k | 26s |
| plan-verifier | 1 | 4 | 102k | 4.8k | 32s |

All four agents ran on sonnet-5-5 (20 calls, 728k cache read, 18k output); the main session on the same model (13 calls).

| # | Agent | Brief chars | Paths named | Files read | In brief | Found alone | Errors (blocked) | First ctx → peak ctx |
|---|---|---|---|---|---|---|---|---|
| 1 | implementer | 298 | 8 | 10 | 7 | 0 | 0 (0) | 31k → 82k |
| 2 | implementer | 190 | 3 | 4 | 2 | 0 | 0 (0) | 31k → 50k |
| 3 | plan-verifier | 1.4k | 6 | 3 | 1 | 0 | 0 (0) | 20k → 44k |
| 4 | architecture-reviewer | 619 | 9 | 3 | 2 | 0 | 0 (0) | 32k → 50k |

Files read by three or more agents: the plan (13 kB; agents 1–4, 5 reads) and the plugin's `profile-reference.md` (agents 1–3).

## Findings

### calling-session

- F1 [calling-session] cost — The calling session made 13 calls and read 698k tokens from cache (49% of the run's 1.4M), 54k per call, to launch four agents, one after another. Evidence: Totals, main session row against subagents row. Cost: 698k cache read; the session was working alone for 18s of the 2m 28s window.
- F2 [calling-session] ease — The run took one human prompt, no question round and no wait for the user, and ended with no fix launch. Evidence: Totals line (human prompts 1, AskUserQuestion rounds 0); "Where the time went", waiting 0s. Cost: n/a.

### plan

- F3 [plan] ease — No agent found a file alone, no tool call errored, and no guard refused one; the briefs were the §9 lines (190–298 chars for the implementers) that name the write set and the check command. Evidence: "Briefs against what was read", Found alone 0 for #1–#4; Errors 0 (0) for #1–#4; plan §9. Cost: n/a.
- F4 [plan] duplication — The plan splits one track into two implementer launches although §9 says the three stages are chained and share `server.ts` and its test: #2 starts again from a 31k context for one stage that writes one file, 13 tool uses and 26s. Evidence: plan §9 ("Mode: single-agent. One package, three chained stages sharing `server.ts` and its test"), its two briefs; Agents rows #1 and #2. Cost: #2 is 165k cache read and 3.4k output; the 31k start (plan, profile reference, shared sections) is read a second time.
- F5 [plan] duplication — The plan (13 kB) was opened by all four agents and `profile-reference.md` by the first three, including the stage-3 implementer, whose stage touches one file. Evidence: "Files read by three or more agents". Cost: n/a — two files, a few kB each in standing context.

### implementer

- F6 [implementer] ease — Both implementers worked from Read and Edit (11 Read, 13 Edit; 5 Read, 4 Edit) with 2 explore-class Bash calls each and one Grep and one Glob each. Evidence: "Tool calls per agent" rows #1, #2. Cost: n/a — the last entry measured 70 explore-class Bash calls and no Grep or Glob for 8 implementers.

### architecture-reviewer

- F7 [architecture-reviewer] handoff — Its 619-char brief named 9 paths, and the agent opened 3 files with Read (2 from the brief) and reached 5 more through the shell. Evidence: "Briefs against what was read" row #4. Cost: n/a — whether the other paths were needed is not established.

## Proposals

First to take: P1 — the only measured saving that is bigger than a rounding error here (a whole agent's start-up), and it is a one-line change to the plan.

- P1 → `sdd-engineering:implementation-planner` — In the Execution section, when the mode is single-agent and the stages are chained through the same files, give one track one brief covering all its stages instead of one brief per two stages. From: F4 · Effect: one implementer launch and its 31k start-up context fewer per run of this size (#2: 165k cache read, 26s) · Effort: S · Status: proposed
- P2 → `sdd-engineering:implementer` — In Step 0, say a later stage of the same plan reads section 4 for its own stage and sections 0–3 only at the lines its stage cites, so the plan is not read in full by each brief. From: F5 · Effect: less standing context in a one-file stage; the plan stops being the file read by every agent · Effort: S · Status: proposed

## Earlier proposals

Targets of the last entry were `.claude/agents/*`, `.claude/commands/implement.md`, `.claude/skills/*`; commit `6a3da56` removed them from the repository and the run used the `sdd-engineering` plugin, so each was checked in its plugin copy.

- 2026-10-06-pr-brief P1 — not applied (`/implement` is no longer in the repository; the plugin has no `commands` folder)
- 2026-10-06-pr-brief P2 — not applied (`sdd-engineering:implementation-planner` still has no Write or Edit)
- 2026-10-06-pr-brief P3 — not applied (`pr-self-review` is not in the repository any more; the plugin copy was not opened)
- 2026-10-06-pr-brief P4 — not applied (`sdd-engineering:implementer` Step 0 item 2 still reads the insights files in full)
- 2026-10-06-pr-brief P5 — not applied (`sdd-engineering:implementer` Step 0 item 1 still reads "your row and brief in section 9")
- 2026-10-06-pr-brief P6 — not applied (the plugin's `collect-run.mjs` prints one main-session row, no Resumes table)

## For engineering-insights

none

## Not established

- The outcome of each launch, the `plan-verifier` counts and so `criteria`; the files the run changed.
- The command that drove the run, and whether the session itself edited anything between the launches (18s alone).
- Whether the reviewer's and verifier's reports held findings: no launch followed them, which may mean none, or that the user took them from there.
- Whether the plan's split into two briefs was a choice or a default of the planner.
