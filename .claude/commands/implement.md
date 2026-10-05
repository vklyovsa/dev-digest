---
description: "Spec Driven Development, the build half: executes an approved Implementation Plan with implementer agents (one brief each), then plan-verifier, then architecture-reviewer with fix rounds until its findings are closed, and reports. spec-creator and implementation-planner are run by hand before it; test-writer is not part of it."
argument-hint: "<plan or spec path> [design paths…] [--security] [notes for this run]"
disable-model-invocation: true
---

# /implement — build an approved plan

You are the calling session of the pipeline in `.claude/agents/README.md`, from the approved
plan onwards. You orchestrate and the agents work: you write no code, you do not read the
diff or the source files, and you do not repeat a check that an agent's report already
carries. Every turn of yours re-reads your whole context, so independent calls go out in
one message.

Arguments: $ARGUMENTS

## Not in this command

- `spec-creator` and `implementation-planner` — the user runs them by hand first. No plan,
  or a plan that is not ready, is a reason to stop, never a reason to write one.
- `test-writer` and `doc-writer` — not started here. `security-reviewer` only with
  `--security`. The report says what was left out.
- Commits, pushes, PRs, the dev stack, migrations on the dev DB.

## 0 — Preflight

1. Sort the arguments:
   - a path ending in `-plan.md` → the plan; another `.md` in a `specs/` folder → the spec,
     and the plan is the file beside it with `-plan` before `.md`;
   - image or PDF paths, and anything under `docs/design/` → design references;
   - `--security` → `security-reviewer` runs next to the architecture review;
   - the remaining text → notes for this run.
2. In one message: `grep -n '^## \|^### Stage' <plan>`, `git rev-parse --short HEAD`,
   `git status --short`. Then read the plan's header, §6, §7 and §9 — not the stages, they
   are the implementers'. A plan written before §9 carried briefs: cut its stages into
   briefs of one or two, in order, one track.
3. Stop and say what is missing when:
   - there is no plan file → "run `implementation-planner` on the approved spec first";
   - the plan's `Source:` is a spec with a `Status:` line that is not `approved`.
4. Ask the user (`AskUserQuestion`), never answer yourself, when:
   - §7 still holds a `[blocking]` line or §9 `Mode:` is undecided. An answer that only
     settles the mode or confirms the option the plan assumes is recorded in the plan (§9
     `Mode:`, §7); any other answer means the plan goes back to `implementation-planner` —
     stop;
   - a note asks for behaviour the plan does not contain. That is a requirement and belongs
     in the spec and the plan, not in a brief: continue without it, or stop. A note may only
     narrow the run (which stages, which track) or say how to run it.
5. Keep the `git status --short` list: those files were changed before this run, and the
   verifier and the reviewer are told so. `HEAD` differing from the plan's `Base:` is said
   to the user, then the run goes on.

## 1 — Implement

- Order by the §9 table: a track marked `alone` by itself, `parallel` tracks together;
  inside a track the briefs strictly in order.
- One `implementer` per brief, a fresh one every time. The first brief of every parallel
  track is launched in a single message; when one reports, that track's next brief starts.
  Two implementers whose write sets overlap never run together.
- The prompt is the brief as §9 words it, plus the notes that apply to it, plus the design
  references — only for a brief whose write set lies in `client/`.
- From each report read `Status`, `Verification` and `Not done / blockers`:
  - `done` → the next brief;
  - `partial` or `blocked` → that track stops. A blocker only the user can decide is asked;
    a missing change outside the write set becomes a fix brief (below) once no running
    implementer owns that file.

## 2 — One check over everything

```bash
.claude/agents/scripts/check-code.sh <every package the run touched>
.claude/agents/scripts/check-code.sh --it server   # only when the plan's §6 lists it
```

Red → a fix round before any agent reviews the diff.

## 3 — plan-verifier

One instance; remember it for the recheck. Give it the plan path, the `Deviations from the
plan` and `Not done / blockers` sections of the implementation reports as they were
returned, and the list of files changed before the run.

- `missing`, `partial`, `deviated (undeclared)` → a fix round, then a recheck: `SendMessage`
  to that same instance with the items. A test the plan lists under `Tests to add` is such
  an item — the implementer writes it.
- An acceptance criterion with no test at all is not fixed here (`test-writer` is not part
  of this command): it goes into the report.
- A `Needs a test run` row `check-code.sh` covers → run it; any other → the report.
- At most two fix rounds; items still open after them go to the user.

## 4 — Architecture review, with fix rounds

Start `architecture-reviewer` — and `security-reviewer` in the same message with
`--security` — with the plan path (its `Base:` and §8) and the list of files changed before
the run. Remember the instance. Then loop:

1. No CRITICAL and no WARNING → leave the loop. A SUGGESTION is never fixed here; it goes
   into the report.
2. A fix round for every CRITICAL and WARNING.
3. `check-code.sh` on the packages the fix touched.
4. Recheck: `SendMessage` to the same reviewer instance with the IDs of the findings that
   were fixed and the files the fix touched. It answers per finding — `resolved`,
   `still open`, `changed` — and reviews only the lines the fix changed.

At most three fix rounds. Stop the loop and ask the user — another round, accept what is
open and go on, or stop — when the cap is reached with a CRITICAL or WARNING open, when the
same finding is `still open` after two attempts, or when fixing a finding would contradict
the plan or the spec: then the plan is what is wrong, and that is not the implementer's call.

When at least one fix round ran here: one recheck by the `plan-verifier` instance, limited
to the files those fixes touched, then step 2 once more.

## Fix round

Used by steps 2, 3 and 4.

- Group the items by package; one fresh `implementer` per group, groups with disjoint
  files in one message.
- The brief:

  ```
  Fix brief for <plan path> — <check-code | plan-verifier | architecture review>, round <n>.
  Items, as returned:
  <the finding blocks, the verifier rows or the check-code excerpt — pasted, not retold>
  Write only inside: <the files the items name, and their tests>.
  Fix exactly these items; anything else you notice goes under "Not done / blockers".
  Check with: .claude/agents/scripts/check-code.sh <package>.
  ```

- Never paraphrase a finding, never widen a brief, never make the fix yourself.

## 5 — Report

In Ukrainian, short:

- the plan, the mode, the briefs that ran;
- the final `check-code.sh` lines, as printed;
- `plan-verifier`: its counts, and what is still not done;
- the review: findings fixed per round, what stays open (SUGGESTIONs, items the user
  accepted), how many rounds it took;
- not run: `test-writer` (with the criteria that have no test), `doc-writer`,
  `security-reviewer` unless `--security` — and the security surfaces the plan's §8 names;
- next: `/pr-self-review`, then the user commits.

## Never

- Edit production code, tests, a spec or a plan's stages — the plan's `Mode:` line and a
  settled §7 question are the only lines of it you write.
- Commit, push, open a PR, start the dev stack, or run a migration on the dev DB.
- Start `spec-creator`, `implementation-planner`, `test-writer` or `doc-writer`.
- Answer an agent's `Questions for the user` or `Clarification needed` for the user.
- Start a new reviewer or verifier for a recheck when the first instance can be messaged.
- Go past a round cap without asking.
