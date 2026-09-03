---
id: B130
title: Re-approving a contact leaves an expired grant expired, so the approval does nothing
type: ISSUE
priority: low
complexity: low
area: contacts, grants
found: "2026-09-03"
---

# B130 — Re-approving a contact leaves an expired grant expired, so the approval does nothing

## Why

Found while fixing **B82**, and deliberately not absorbed: B82 is about a
reader that skipped the expiry question, this is about the writer that cannot
answer it.

`approveContact` (`lib/contacts/index.ts:647`) guards its grant insert on the
row merely existing:

```ts
const grant = await db
  .selectFrom("access_grants")
  .select(["id"])
  .where("owner_id", "=", owner)
  .where("contact_id", "=", id)
  .where("scope", "=", "read")
  .executeTakeFirst();

if (!grant) {
  await db.insertInto("access_grants").values({ …, expires_at: null }).execute();
}
```

That is the same "a row exists" test B82 removed from `lib/push.ts`, in the
other direction. A grant whose `expires_at` has passed is not a grant —
`grantIsLive` says so, and every reader now honours it — but it is still a
row, so the guard fires and the insert is skipped. The owner clicks approve,
the contact goes `active`, and the person is still refused: no panel entry, no
gate, no digest, no push.

Nothing writes a non-null `expires_at` today, so this cannot happen yet. It
becomes live the moment a time-limited invitation ships, which is the same
feature B82 was fixed ahead of — and the failure mode is worse to diagnose,
because the UI reports success.

The revoke path is not affected: `revokeContact` (`lib/contacts/index.ts:693`)
deletes the grant outright, so revoke-then-approve already writes a fresh row.
Only expiry-without-revoke reaches this.

## Work

- Decide what approving means when a grant exists but has run out. The
  straightforward answer is that approving is an owner saying "let them in
  now", so it should clear `expires_at` (or write a new expiry the caller
  supplies) rather than leave a dead row standing.
- Ask `grantIsLive` rather than testing for a row, so this file agrees with
  `lib/grants.ts` like every reader now does.
- Not in scope: issuing time-limited grants at all. There is still no caller
  that sets an expiry, and adding one is the feature this bug is waiting for,
  not the fix.

## Acceptance

- A contact whose `read` grant has `expires_at` in the past, put back through
  `approveContact`, holds a live grant afterwards — `contactsWithReadGrant`
  contains them, `mayReadTrip` opens the journal's `guest` trips, and
  `subscribersFor` includes their subscription.
- A test in `test/access-gate.test.ts` or `test/contacts.test.ts` that fails
  before the change, reaching into the row the way the expiry case in
  `test/access-gate.test.ts` already does.
- The four checks.
