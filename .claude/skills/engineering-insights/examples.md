# Entry examples — rejected vs accepted

> **These are shape examples.** Except for the one marked *(real)*, the content is
> invented to show form. Do not cite anything here as a fact about this repository.

The test behind every pair: *if this were obvious to anyone reading the code, don't
write it.* The second test: read the entry cold, with no memory of the session — do you
know what to do?

---

## What Works

❌ `- **SSE is good for progress updates.**`
Names a technology and an opinion. Nothing to act on.

✅
```
- **A long import is safe to interrupt but not to restart.** The job row is marked
  `running` before the first fetch and only cleared on success, so a crashed import
  blocks a retry until the row is reset (`src/platform/jobs.ts`).
  → Clear the stale row before re-running, or the second attempt silently no-ops.
```

## What Doesn't Work

❌ `- **Promises can be tricky.**`
The canonical noise entry: true of every codebase, useful in none.

✅
```
- **`Promise.all()` over the ingest pipeline times out past ~30 items.** Each item opens
  its own connection, so the pool starves before the slowest settles.
  → Use `Promise.allSettled()` in batches of 10; a partial failure must not void the batch.
```

❌ `- **Tried a few approaches to the cache, ended up with the simple one.**`
A narration of the session. What was tried, and why did the others fail?

## Codebase Patterns

Architectural **decisions** belong here — with the reason, or the next session reopens
the argument from scratch.

❌ `- **We use Zod for validation.**`
Already visible in every route file.

✅
```
- **State shared by more than two components goes through the store, not props.** The
  cart is read by three components, and prop-drilling it was reverted twice before
  `cartStore.ts` landed.
  → Local state for a single consumer; the store from the second consumer onward.
```

## Tool & Library Notes

✅ *(real — this entry lives in `client/INSIGHTS.md`)*
```
- **Grepping rendered Next.js HTML for `This page could not be found` gives false
  positives.** The string ships inside the RSC flight payload (`<script>self.__next_f…`)
  on pages that render fine, so a plain `curl | grep` reports a 404 that is not there.
  → Check the HTTP status first, and strip `<script>`/`<style>` before matching text.
```

Why it works: a named symptom, the mechanism that causes it, and a different procedure
to use instead. A reader who has never seen the page knows what to do.

## Recurring Errors & Fixes

Always symptom → cause → fix. The symptom line should carry the string someone will
actually grep for.

❌ `- **Fixed the migration error.**`

✅
```
- **`relation "pull_requests" does not exist` on a fresh clone.** Migrations do not run
  on boot, so the failure surfaces at route level rather than at startup.
  → `cd server && pnpm db:migrate`. It is never a code bug.
```

## Session Notes

Date from `date +%F`. Two to four lines, and prune the entry once its content has moved
into a section above.

✅
```
### 2026-09-16 — import pipeline left mid-refactor
Batching landed behind a flag, off by default; the retry path is untested. The stale
`running` job row from the crashed run was cleared by hand, not by code.
```

## Correcting an entry that went stale

Never edit or delete the old entry. Append a new one above it — newest-first puts the
correction where a reader hits it first, and the history stays legible.

✅
```
- **Corrected 2026-09-16:** the ingest batch limit is 25, not 10. The pool was resized in
  `docker-compose.yml`, so the earlier figure below is now wrong rather than wrong-headed.
  → Keep batching; the number moves with the pool, so read it from config, not from here.
```

## Open Questions

An entry here is a debt, not a note. Delete it when it is answered — the answer moves
to another section.

✅
```
- **Unclear whether the grounding gate can drop a finding that cites a moved line.**
  Not reproduced; suspected when a diff renames a file in the same commit.
  → Reproduce with a rename-plus-edit PR before trusting the gate's count.
```

❌ `- **Should we refactor the adapters?**`
An opinion with no observation behind it. Not a question the code raised.
