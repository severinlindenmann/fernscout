---
id: B53
title: One page render resolves a signed-in reader's session five times
type: ISSUE
priority: low
complexity: medium
area: auth, performance
found: "2026-09-01"
started: "2026-09-04T06:50:27Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:50:27Z"
---

# B53 — One page render resolves a signed-in reader's session five times

## Why

`resolveSession` (`lib/auth/index.ts:532`) is not a read. It ends with an
`UPDATE sessions SET last_seen_at = …`, so every call is a write transaction.

One page render, for a reader signed in and looking at a gated trip, calls it
five times:

1. `app/[user]/layout.tsx:61` — the `signedIn` flag for the site summary.
2. `listableTrips` (`lib/tripGate.ts:154`) — the trip switcher.
3. `isJournalGuest` → `journalReader` (`lib/contacts/session.ts`), from the same
   `listableTrips`.
4. `isTravellerOn` (`lib/tripGate.ts:47`), from `mayReadTrip`.
5. `isJournalGuest` again, from `mayReadTrip`.

The first three predate B41; the last two are B41's, and it added the fourth and
fifth by teaching two more call sites to ask who is asking. Each of the five
also re-reads the cookie jar and re-joins `sessions` to `users`.

Nothing is wrong with the answers — this is a cost, not a bug, and it is the
right trade for having one function that decides who is a guest rather than
three that might disagree. But five write transactions per page view for every
signed-in reader is the kind of thing that is invisible on SQLite with one
reader and expensive on Postgres with fifty.

## Work

The App Router already has the mechanism: `cache()` from `react` memoises a call
for the duration of one request. Wrapping `resolveSession` — or a thin
`currentSession()` in front of it — would collapse all five into one lookup and
one `last_seen_at` write, with no call site changing.

Two things to get right:

- **`last_seen_at` must still be written**, once per request rather than five
  times. That column is what the owner's sessions list shows.
- **The test suite calls these functions outside any request**, flipping the
  mocked cookie jar between calls in the same process — `test/access-gate.test.ts`
  does exactly this. A cache that outlives a request would make those tests
  answer the previous viewer's question. Check what `cache()` does outside a
  render before relying on it, and if it does not scope cleanly, do nothing:
  five indexed queries is a smaller problem than a gate that caches the wrong
  reader.

Not doing: changing what any of the five callers ask, or how.

## Acceptance

- A single page render for a signed-in reader issues one session lookup and one
  `last_seen_at` write, demonstrated by counting queries rather than by
  inspection.
- `test/access-gate.test.ts` and `test/viewer.test.ts` still pass, including the
  cases that change viewer between assertions in one process.
- No call site had to learn that the lookup is cached.
