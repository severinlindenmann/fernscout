---
id: B1175
title: a journal deletion that fails partway leaves the journal gone, no tombstone, and a spent confirmation link
type: ISSUE
priority: high
complexity: medium
area: deletions, registry, ops
found: "2026-09-09T20:20:00Z"
started: "2026-09-11T12:32:28Z"
merged: "2026-09-11T12:59:01Z"
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

## Built, 2026-09-11

**New order in both `deleteJournal` and `deleteTrip`:** gather the summary,
notice and (for a journal) the owner's address/tel — all reads, unchanged —
then `writeTombstone(...)` **first**, before anything is touched. Everything
after that point is split into two kinds of step, not treated uniformly:

- **Content** (the database rows and the folder itself) runs inside a single
  `try`, and a throw there is *captured* rather than swallowed — the tombstone
  is already down, so nothing is lost by continuing, but the failure is real
  and must not be reported as success.
- **Hygiene** (`dropMediaCache()`, and for a journal `release()` on the
  `.registry/` locks) runs through a small `bestEffort()` helper that logs and
  continues — this is exactly where the live incident's `EACCES` was, and now
  it can never again skip the tombstone or block the other hygiene step.
  `clearUserCache()`/`clearConfigCache()` run unconditionally after both.

The captured content failure is rethrown at the very end of the function, once
hygiene has run. `deleteTrip` got the identical treatment (same shape, minus
`release()`, which trips never touch) — the ticket asked to decide this
explicitly, and the answer is yes: leaving `deleteTrip` on the old order would
have reintroduced exactly this bug for trip deletions the moment anything in
its own sweep threw.

**The 410 window:** accepted, not engineered around. Between the tombstone
write and the folder actually leaving disk, a concurrent reader can hit `410`
on a journal that is still fully present — for local SQLite, all synchronous
JS between two lines; for Postgres, the span of the DB delete loop plus one
`rmSync`, typically low milliseconds. No "provisional" flag was built: the
decision above already named this as the traded-for cost, and a flag that
itself needs to be cleared under the same partial-failure conditions this
ticket is about would just move the bug rather than remove it.

**The spent link:** `confirmDeletion` now wraps the `deleteJournal`/
`deleteTrip` call in `try/catch`; on a throw it resets `consumed_at` to `null`
and rethrows, so the *same mail link* works again — no operator, no shell.
This surfaced a second, related bug, fixed alongside it: `resolveDeletionToken`
resolves the target through `getUser`/`userExists`, which (correctly, for
every other caller) treat a tombstoned name as gone — so the instant the
tombstone landed, the token's own re-resolution read the target as "gone" and
refused the retry with the wrong reason. Fixed by threading an
`ignoreTombstone` option through `getUsernames`/`userExists`/`getUser` (mirrors
the option `isReservedUsername` already had for `createJournal`'s reclaim
case) and having `resolveDeletionToken` alone pass it — every other caller in
the codebase is unaffected, and a genuinely-gone journal (directory actually
absent) still resolves to "gone" regardless of the option, since that check
never depends on the tombstone in the first place.

`deleteJournal`'s own DB sweep was also changed to skip `deletion_requests`
until the very last line of its content step (right after the folder is
actually removed) rather than sweeping it with every other table — otherwise
the confirming row itself was destroyed before a later throw, and the retry
above had nothing left to un-consume. `deleteTrip` already skipped it
entirely, unchanged.

**Test:** `test/deletions.test.ts`, "a step throwing after the tombstone
still leaves the tombstone, the 410, and the hygiene that follows it" — stubs
`fs.rmSync` to throw only for the journal's own directory (the live EACCES's
shape, generalised), then asserts: `confirmDeletion` rejects rather than
reporting success; the tombstone exists; the old URL answers `410`; the
*next* hygiene step (`release()`) still ran, freeing the owner's email for a
new journal even though the old folder is still on disk; and the same
confirmation token, pressed again, now completes and actually removes the
folder. Confirmed failing on the pre-fix code by `git stash`-ing the
`lib/` changes and running just this test: it failed at the very first
assertion (`journalTombstone(user)` was `null`), because the unfixed code
still writes the tombstone last.

**Out of scope, unchanged:** whether `npm run registry -- reconcile` belongs
behind `/admin` — not built, per the ticket. Worth noting: this fix makes
that question lower-stakes than it looked, since the registry-lock failure
that motivated it (release() throwing) can no longer strand a journal or a
link; reconcile would now only be needed to repair a registry that was wrong
for some *other* reason.

`npm run verify`: build, tsc, eslint, 6865 tests passed (4 skipped across 522
files), knip clean. Exit code 0.
