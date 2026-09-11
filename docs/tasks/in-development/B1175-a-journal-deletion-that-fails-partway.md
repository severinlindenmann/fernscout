---
id: B1175
title: a journal deletion that fails partway leaves the journal gone, no tombstone, and a spent confirmation link
type: ISSUE
priority: high
complexity: medium
area: deletions, registry, ops
found: "2026-09-09T20:20:00Z"
started: "2026-09-11T12:32:28Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T12:32:28Z"
---

# B1175 — a journal deletion that fails partway leaves the journal gone, no tombstone, and a spent confirmation link

## Why

`deleteJournal` in `lib/deletions.ts` does five things in a row, none of them
guarded and none of them reversible:

1. delete every row in `TABLE_NAMES` that names the journal
2. `fs.rmSync(dir)` — the journal's own folder
3. `dropMediaCache()`
4. `release(username, email, tel)` — the `.registry/` locks
5. `writeTombstone(...)`

A throw anywhere in 1–4 skips the tombstone. And by then `confirmDeletion` has
already set `consumed_at` on the `deletion_requests` row — that write is
deliberately first, so two presses at once cannot both delete — so the link in
the mail is spent and cannot be pressed again. The caller gets a bare `500`
with no body. There is no way back through the API: `DELETE /api/v1/<user>` on
the half-deleted journal answers `404`, because `getUser` no longer finds it,
and there is no tombstone to make it a `410` either.

Observed on the live instance driving B1136:

```
POST /api/v1/armtest-a/deletions/… → 500
⨯ Error: EACCES: permission denied, unlink
  '/var/lib/fernscout/content/.registry/email/8d75bd…json'
```

The directory and the database rows were gone; step 4 threw; no tombstone was
written and the email lock stayed behind, so the address still could not
create a journal and the username still could not be reused. Recovering it
needed a shell on the server and `npm run registry -- reconcile` — exactly the
thing the whole `DELETE` route exists so an owner never needs.

The EACCES had its own cause, fixed on the box and captured as B1176. **That
is not the bug here**: the registry being unwritable is a misconfiguration, and
a misconfiguration must not be able to destroy somebody's journal halfway and
hand them a link that no longer works.

Note what the ordering also means. The tombstone is what makes a deleted
journal's old URLs answer `410` and keeps its name reserved — and it is written
**last**, after everything it describes has already been destroyed. It is the
record of the event, produced only if nothing went wrong during the event.

## Work

- Decide the order from what is recoverable. Writing the tombstone *first* —
  from `summarise()`, which already runs before anything is removed — makes
  every later step idempotent and re-runnable: the journal reads as gone from
  the first instant, and a retry has a record to work from. The current order
  optimises for "never leave a tombstone for a journal that is still there",
  which is the less damaging of the two failures.
- Whatever the order, the steps after the point of no return must not abort
  each other. `release()` failing must not cost the tombstone; `dropMediaCache`
  failing must not cost either. Consider the treatment `recordUsage` and
  `keepCopyOf` already have, and for the same reason — the destructive part has
  happened, and losing the bookkeeping to a failed unlink is trading the
  product for the ledger.
- A partly-deleted journal needs a way back that is not a shell. Either the
  confirm route becomes safely retryable — release the `consumed_at` claim when
  the deletion throws, so the link still works — or `DELETE` on a journal with
  a folder but no config, or a config but no folder, finishes the job rather
  than 404ing.
- `npm run registry -- reconcile` is the existing repair and is reachable only
  over SSH. B671 deleted a CLI-only path for exactly this reason: a hosted
  journal's owner has no shell. Capture separately whether reconcile belongs
  behind the operator's `/admin`.

Not doing here: the ownership fix on the live box, which is done, or how
`.registry/` came to be root-owned — that is B1176.

## Acceptance

- A test that makes step 4 throw (an unwritable `.registry/`, or a stubbed
  `release`) and asserts the tombstone still exists afterwards, the old URL
  answers `410`, and the name is released.
- A test that presses a confirmation link twice where the first press failed,
  and asserts the second completes rather than answering `409 used`.
- No path through `confirmDeletion` ends with the journal removed from disk and
  no tombstone naming it.

## Decision, 2026-09-11

**Write the tombstone first**, from `summarise()`, before anything is removed.
Chosen over keeping it last and making the later steps non-aborting, because it
fixes the spent-link problem in the same move: every step after the tombstone
becomes idempotent and re-runnable, so a failure partway is a retry rather than a
new state to detect.

The cost is stated rather than hidden: a tombstone briefly exists for a journal
that is still there, so a crash in that window leaves the name reserved and the
journal still readable. That is the recoverable direction, which is the whole
reason for the order.

Verified before deciding: `confirmDeletion` (`lib/deletions.ts:499-527`) spends
`consumed_at` first and calls `deleteJournal` with no try/catch;
`deleteJournal` (587-620) runs DB deletes, `fs.rmSync`, `dropMediaCache()` and
`release()` before `writeTombstone` ever runs, so a throw at any of those skips
the tombstone entirely. `deleteTrip` has the same shape at 672-675.
