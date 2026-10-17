---
name: tracing
description: Violations that only show when a type, a value or a call is followed across files
metadata:
  tags: review, tracing, aliases, purity, composition-root
---

# Following a violation across files

dependency-cruiser and the greps in `rules/enforcement.md` are keyed on **file names and
single lines**: `routes.ts` may not import the schema, `service.ts` may not import the
container. A change can satisfy every one of them and still break the rule they stand
for, by moving the offending line into a file with another name or by hiding a type
behind an alias. A green `./check.sh` therefore proves the cheap half only. The other
half is four traces, each started from the diff and followed until it leaves it.

## 1. The wire trace — where does the response come from? (OA-5)

For every route the change adds, follow the returned value back to where it was made.
If it ends at a Drizzle query whose result was never mapped, table columns are on the
wire — whatever the type is called along the way. Things that carry a row without the
word `Row` in them:

- a repository method with **no return annotation** (the type is inferred from `select()`);
- an alias: `type StalePull = typeof t.pullRequests.$inferSelect`;
- a derived alias: `Awaited<ReturnType<Repo['list']>>[number]`, `Pick<…>`, `Omit<…>` of one;
- an interface with a field of such a type, returned by the service.

Report the place the row should have been mapped (the repository), and name the hops.

## 2. The role trace — what does this file do? (OA-11)

A layer is what the code does, not what the file is called. A function is **transport**
when it takes a `FastifyRequest`, a `reply`, or the `Container`, or is the body of a
route handler — in `handlers.ts`, `controller.ts`, `actions.ts` or anywhere else. OA-1,
OA-2 and OA-9 apply to it exactly as they do to `routes.ts`, and the greps will not see
it, because they only read `routes.ts`. A `routes.ts` that is a list of one-line
delegations to another file of the module is the signal to open that file.

## 3. The purity trace — does the pure file stay pure? (OA-12)

`helpers.ts` and `constants.ts` promise no I/O. Check the promise one call deep: an
exported function is impure when a private function it calls reads the clock
(`Date.now()`, `new Date()`), randomness, `process.env`, the filesystem or the network.
A constant initialised from `process.env` is an environment read at import time; config
enters through `platform/config.ts` and is passed in.

Time is a parameter: the service reads the clock once and hands `now` to the helper
(`deriveReviewStatus({ …, now })` in `modules/pulls/status.ts` is the model).

## 4. The construction trace — who calls `new`? (OA-13)

Search the diff for `new ` followed by a class from `src/adapters/**`. Outside
`platform/container.ts` and tests it is a second composition root: the adapter cannot
be overridden through `ContainerOverrides`, so the use case can no longer be tested
without the real dependency. A factory function inside a module (`resolveNotifier`,
`makeClient`) that returns `new SomeAdapter(...)` is the same thing with one more hop.

## Reporting a traced finding

Cite the line where the fix goes and list the hops in the Problem cell, so the author
can replay the trace: `repository.ts:9 (inferred) → repository.ts:24 alias StalePull →
types.ts:6 → service.ts:18 → routes.ts:11`.
