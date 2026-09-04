---
id: B53
title: One page render resolves a signed-in reader's session five times
type: ISSUE
priority: low
complexity: medium
area: auth, performance
found: "2026-09-01"
started: "2026-09-04T06:50:27Z"
merged: "2026-09-04T07:42:57Z"
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

Done. `resolveSession`'s body became a private `lookUpSession`, and the export
is `cache(lookUpSession)` from `react`. No call site changed and none of them
knows the memoisation is there.

**What `cache()` does outside a render was checked in the source rather than
assumed**, because the Work section was right to insist on it. React's server
build:

```js
var dispatcher = ReactSharedInternals.A;
if (!dispatcher) return fn.apply(null, arguments);
```

Next installs that dispatcher per request and it goes with the request. With no
dispatcher — a script, a background job, the test suite — the call goes
straight through and memoises nothing. The client build, which is what vitest
resolves because it does not set the `react-server` condition, defines `cache`
as the identity wrapper outright. So `test/access-gate.test.ts` and
`test/viewer.test.ts` are untouched by this: they flip the mocked cookie jar
between assertions in one process and there is no cache in that process to
answer the previous viewer's question.

### How the wall is guaranteed

The risk of this change is decision 24 — a bearer token and a guest cookie are
not interchangeable — so three properties, each asserted rather than argued:

1. **Per request, and never module-level.** There is no map in `lib/auth`. The
   only state is React's per-request cache, which is created and discarded with
   the request. A session revoked on `/<user>/me` stops working on the next
   page view, not on the next deploy.
2. **The kind is part of the key.** `cache` keys on *every* argument, and
   `expected` is the second one, so `(token, "guest")` and `(token, "agent")`
   are separate entries that never see each other's answer. The
   `row.kind !== expected` check still runs for each.
3. **Nothing outside a request is cached at all**, per the source quoted above.

## Acceptance

`test/session-cache.test.ts`, eight cases. It installs and removes a real cache
dispatcher by hand, so "one request" is a scope with a beginning and an end
rather than a stand-in, and it counts queries at the Kysely executor rather
than inspecting the code.

- **One lookup, one write.** Five `resolveSession` calls in one request →
  exactly one `select … from sessions` and one `update … last_seen_at`, and all
  five answers are the same session. Against the code as it stood: five selects.
- **The wall, both directions.** A guest token asked as `"agent"` in the same
  request that just resolved it as `"guest"` returns `null`, and the reverse.
- **Two tokens in one request are two lookups**, so the cache keys on the
  argument and not on "a session was resolved earlier".
- **Nothing outlives the request.** Two scopes → two selects and two
  `last_seen_at` writes; and a session revoked between two scopes is refused by
  the second, which is the test that would fail if this were ever moved to a
  module-level map.
- **Outside a request there is no cache**: three calls, three selects.
- **No call site had to learn** — the signature and the shape are unchanged.

`test/access-gate.test.ts` (and `viewer`, `auth`, `write-revocation`) still
pass: 185 cases, including the ones that change viewer between assertions in
one process.
