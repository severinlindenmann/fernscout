---
id: B82
title: An expired read grant still notifies, because push does not ask lib/grants
type: ISSUE
priority: medium
complexity: low
area: push, grants
found: "2026-09-01"
---

# B82 — An expired read grant still notifies, because push does not ask lib/grants

## Why

Found while fixing **B68**, and deliberately not absorbed: B68 is the missing
`private` question, this is a third question asked in the wrong place.

`subscribersFor` (`lib/push.ts`) does its own grant lookup:

```ts
const grant = await handle.db
  .selectFrom("access_grants")
  .select(["id"])
  .where("owner_id", "=", trip.username)
  .where("contact_id", "=", sub.contactId)
  .where("scope", "=", "read")
  .executeTakeFirst();
if (grant) eligible.push(sub);
```

A row existing is not a grant being live. `lib/grants.ts` says so in its own
words — it is "the one place that decides", and both `isJournalGuest` and
`contactsWithReadGrant` run every row through `grantIsLive(expires_at, now)`.
Push is the only reader of that table that does not.

B41 recorded the decision this breaks: `access_grants.expires_at` is the record
of *until when* somebody was let in, and "the point is that the answer changes
for both surfaces at once". `test/access-gate.test.ts` asserts exactly that for
the panel and the gate, by reaching into the row and setting an expiry in the
past. Push would still notify.

Nothing writes a non-null `expires_at` today, which is the only reason this is
not live. The moment anything does — a time-limited invitation is the obvious
first feature — a revoked-by-expiry reader keeps getting notifications, and it
is the channel that interrupts.

## Work

- Do not add the expiry predicate inline; that is what created the drift. The
  fix is to ask `lib/grants.ts`.
- `contactsWithReadGrant(owner, now)` returns a `Set<string>` of contact ids in
  **one** query. `subscribersFor` currently runs two queries per subscription
  in a loop, so using it replaces N+1 lookups with two — a simplification, not
  a second lookup. The `status === "active"` check stays; the digest's
  `planDigest` asks both in the same order and `test/access-gate.test.ts`
  documents why.
- Check whether `lib/push.ts` may import `lib/grants.ts` — the file
  deliberately avoids `lib/contacts` (docs/plans/W12-push.md), and whether that
  applies here needs an answer rather than an assumption. `lib/grants.ts` reads
  `access_grants` only and touches no encrypted contact field.

## Acceptance

- A subscription whose contact's grant has `expires_at` in the past is not
  notified about a `guest` trip — the case that fails today.
- The expiry row in `test/access-gate.test.ts` ("a grant that has expired is
  not a grant") covers push alongside the panel and the gate, in the same
  table.
- `subscribersFor` no longer queries `access_grants` itself.
- The four checks.
