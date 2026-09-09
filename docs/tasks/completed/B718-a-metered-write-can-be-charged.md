---
id: B718
title: A metered write can be charged twice after a restart
type: SECURITY
priority: high
complexity: low
area: credits, api
found: "2026-09-07T11:44:09Z"
started: "2026-09-08T05:20:12Z"
merged: "2026-09-08T05:27:42Z"
completed: "2026-09-09T16:44:51Z"
---

# B718 — A metered write can be charged twice after a restart

## Why

`lib/idempotency.ts:23` keeps its store **in memory, per process**. That was an
honest trade for `/api/v1` writes, where the filesystem is the real backstop: a
replayed day write finds the day already there.

`POST /api/helper/<user>/day/write-day` (B684) breaks that assumption, because
it is the first route where the idempotency key guards **money**. It spends a
credit, calls the model, and writes nothing to disk — so there is no filesystem
backstop at all. After a server restart, or on a second Node process behind a
load balancer, a retried request is a fresh key and the journal is charged a
second credit for the same words.

The instance already has a database, and the ledger this protects is in it.

Found while building B684 and reported rather than fixed.

## Work

Give the idempotency store a durable backend when a database is configured,
keeping the in-memory one for instances without. Key rows by owner and key,
with the answer and an expiry.

Check every current caller: a route that relies on the current
per-process semantics for something other than money should keep working
unchanged.

## Acceptance

A credited write replayed after a process restart returns the first answer and
charges nothing. A test covers it with the store's durable backend.

## What was built

`lib/db/migrations/025-idempotency.ts` adds an `idempotency` table; `recall`
and `remember` in `lib/idempotency.ts` are now async and read and write it when
`DATABASE_URL` is set, keeping the in-memory `Map` for an instance without one.
Both halves are best-effort on the storing side and answer `"fresh"` on a read
that fails — the same answer a process with no database has always given, so a
database that will not answer costs a duplicated call and never a refusal.

Two things found while building it:

- **The row id is a sha256 of the key, not the key.** `idempotencyKey` joins
  with a NUL byte (B297) and Postgres `text` cannot hold one, so the insert
  would have thrown, been swallowed by the deliberate `catch`, and left the
  durable half silently doing nothing on the one dialect production runs.
  `test/idempotency-durable.test.ts` has a Postgres leg for exactly this; it
  runs in CI and skips on a laptop with no `POSTGRES_TEST_URL`.
- **`owner_id` is the journal**, so `deleteJournal`'s `TABLE_NAMES` sweep takes
  these rows with the journal like every other table.

Not doing: closing the window where two *concurrent* identical requests both
read `"fresh"` and both charge. That is unchanged from before this ticket and
wants a conditional insert rather than a table.

Reviewed by hand rather than through `claude-security`, which needs the
`Workflow` tool this session was told not to use — the same constraint B594
records.
