# Workflow retro — rejected and accepted lines

Each pair shows the form a line must take. The numbers are illustrations of that form,
not a record of any run: an entry cites its own evidence.

## Findings

### A claim needs a pointer and a size

Rejected — nothing to check, nothing to act on:

```
- F1 [implementer] cost — Implementers used a lot of tokens. Evidence: the run. Cost: high.
```

Accepted:

```
- F1 [implementer] duplication — Nine build implementers each read the whole 84 kB plan, six of them three times, though a brief covers one or two stages. Evidence: deep table "Files read three or more times by one agent", rows #3–#9. Cost: about 20k tokens of standing context per agent, re-read on every later call.
```

### A wrong claim, and where it travelled

Rejected — blames, and loses the part the workflow can fix:

```
- F2 [implementer] miss — The stage 1 implementer was wrong about the tests. Evidence: later reports. Cost: n/a.
```

Accepted — two findings, because two modules each have something to change:

```
- F2 [implementer] wrong-claim — Agent #3 reported that client test files are not type-checked; agent #7 found they are when its first check failed on a test file. Evidence: agent #3 report § Notes for the tracks; agent #7 report § INSIGHTS. Cost: one failed check run.
- F3 [calling-session] handoff — The claim of F2 was copied into the briefs of agents #5 and #7 before anyone verified it. Evidence: both briefs, the sentence on test files. Cost: see F2.
```

### A fact about the code is not a finding

Rejected — true, but it is about the repository:

```
- F4 [implementer] friction — reviews-skills.it.test.ts flakes because the trace is stored after the run turns done. Evidence: agent #10 report. Cost: n/a.
```

Accepted — the workflow side stays here, the fact goes under "For engineering-insights":

```
- F4 [implementer] friction — Two implementers each re-ran a known flaky test to rule their own change out, although the earlier one had already reported it. Evidence: agents #6 and #10 reports § Verification. Cost: two extra integration runs.
```

### What went well is a finding too

Accepted — it says what to keep, and why it worked:

```
- F5 [plan] ease — No build implementer opened a file it had to find on its own: every Read was named in the brief or in the plan. Evidence: deep table "Briefs against what was read", Found alone 0 for #3–#11. Cost: n/a.
```

### The user's side of the run

Accepted:

```
- F6 [calling-session] human-load — The user asked three times whether the run was still going while the session waited for one long foreground agent. Evidence: user messages after launches #1 and #2; "Where the time went", one agent running 67%. Cost: three prompts.
```

## Proposals

### One file, one change, concrete enough to apply

Rejected — a wish, not a change:

```
- P1 → `.claude/agents/implementer.md` — Make implementers more efficient. From: F1 · Effect: fewer tokens · Effort: M · Status: proposed
```

Accepted:

```
- P1 → `.claude/agents/implementer.md` — In "Read first", replace "read the plan" with: list the headings (`grep -n '^## \|^### Stage'`), then read §0–3, the stages of the brief and §6–7 by line range — never the whole file. From: F1 · Effect: about 60 kB less standing context per implementer · Effort: S · Status: proposed
```

### Aim at the module that can stop it

Rejected — asks an agent never to be wrong:

```
- P2 → `.claude/agents/implementer.md` — Implementers must not make false statements in reports. From: F2 · Effect: no wrong claims · Effort: S · Status: proposed
```

Accepted — the relay is where a wrong claim can be stopped:

```
- P2 → `.claude/commands/implement.md` — In § 1, add: a statement from a report enters the next brief only after one command has confirmed it, or marked "reported by stage N, not verified". From: F2, F3 · Effect: a wrong claim stops at the brief · Effort: S · Status: proposed
```

## Earlier proposals

```
- 2026-10-04-project-context P1 — applied — the problem did not recur
- 2026-10-04-project-context P2 — not applied · recurring ×2 (F3)
- 2026-10-11-run-history P4 — applied — it recurred (F7)
```
