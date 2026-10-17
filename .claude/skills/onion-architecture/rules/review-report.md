---
name: review-report
description: The shape of a layering review — rule IDs, locations, a verdict line
metadata:
  tags: review, report, verdict, ci
---

# Reporting a layering review

A review is read twice: by the author, who needs to know what to change, and by a
script or a later reviewer, who needs to know whether the change may merge and which
rule each objection rests on. A finding without a rule is an opinion; a review without
a verdict has to be re-read to learn its conclusion.

## Every finding names its rule

Use the dependency-cruiser rule name when the graph reports the problem
(`no-cross-module-internals`, `no-domain-to-infra`, …), otherwise the checklist ID from
`SKILL.md` (`OA-1` … `OA-13`). One finding, one rule — if two rules are broken on the
same line, write two rows.

Something that is worth saying but breaks no rule here (a missing test, a duplicated
block, naming) goes under **Notes**, without an ID. Keeping it apart is what lets the
verdict mean "the layering is intact" rather than "the reviewer had no remarks".

## Shape

Write the prose in the user's language; keep the headings' meaning, the IDs and the
`Verdict:` line literal.

```markdown
## Must fix
| # | Rule | Where | Problem | Fix |
|---|------|-------|---------|-----|
| 1 | OA-2 | server/src/modules/pulls/routes.ts:52 | route reads `container.pullsRepo` | move the lookup into `PullsService.refresh` |

## Fine as is
- server/src/modules/pulls/repository.ts:154 — Drizzle belongs in a module repository

## Notes
- no hermetic test for the new use case

## Checks run
- `./check.sh` — tsc ok, depcruise: no violations
- grep for adapters in routes — not run

Verdict: BLOCK — 3 must-fix
```

- **Where** is `path:line`, the path from the repository root.
- **Fine as is** lists the parts of the diff a reader might suspect and that are
  correct. It shows they were looked at, and stops the next reviewer raising them.
- **Checks run** reports what was executed and what was not. Never present a check you
  did not run as passed.
- The last line is `Verdict: BLOCK — <n> must-fix` when the table has rows and
  `Verdict: PASS` when it is empty. Nothing follows it.
