---
id: B1362
title: helper_threads writes are unordered, so forget() can lose to an in-flight persist()
type: ISSUE
priority: high
complexity: low
area: lib/helper/thread.ts
found: "2026-09-10T18:25:23Z"
merged: "2026-09-10T18:35:30Z"
---

# B1362 — helper_threads writes are unordered, so forget() can lose to an in-flight persist()

## Why

`persist()` and `drop()` in `lib/helper/thread.ts` are fire-and-forget, which
is right — a person's turn must not wait on a database write. Each opened its
*own* promise chain, though, so nothing ordered them against each other. On
`better-sqlite3` that is invisible: the driver is synchronous and one
statement runs at a time. On Postgres the two statements go to a pool and land
in whatever order it decides.

So a `forget()` fired a moment after a `persist()` can have its `DELETE`
overtaken by the `UPSERT`, leaving the row on disk. The next cold read —
`live()` → `loadFromDb()`, which is every first request on a fresh worker —
resurrects a conversation the person deliberately ended. `liveSession()` after
`forget()` answers with the old session id instead of `null`, which is exactly
what the WhatsApp "new chat" command asks it not to do.

Found by CI, not by a laptop: the `test (postgres)` leg of run 34510753138 (and
34509251866 before it) failed `test/helper-thread-adopt.test.ts > forget ends
the adopted conversation like any other` and
`test/whatsapp-new-chat.test.ts > the 'new chat' command`, while the sqlite leg
of the same matrix passed. That is the matrix earning its keep.

## Work

One serial queue per journal in front of every `helper_threads` read and
write — `serial(username, run)` in `lib/helper/thread.ts`. Per journal rather
than per instance because a journal is the row, and one queue for everybody
would put every conversation behind the slowest write. Reads join it too: a
read is what a stale write corrupts, and `loadFromDb` after a `drop` has to
see the drop.

Not doing: awaiting the writes at the call sites. The module doc's promise
that a turn never waits on the database is the right promise, and this keeps
it.

No new test. The two CI tests above are the check and they already fail on the
dialect where it happens; a local reproduction would need injected latency,
which is a fake of the thing CI has for real.

## Acceptance

The `test (postgres)` leg of CI is green, both named tests passing, and the
sqlite leg unchanged.
