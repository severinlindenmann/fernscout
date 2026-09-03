---
id: B130
title: Re-approving a contact leaves an expired grant expired, so the approval does nothing
type: ISSUE
priority: low
complexity: low
area: contacts, grants
found: "2026-09-03"
started: "2026-09-03T19:32:04Z"
merged: "2026-09-03T19:40:25Z"
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

## What was built

The Why held up in full — the guard, the file, the line and the reasoning were
all still accurate, and the fix is the one the Work section named.

The row is **revived rather than replaced**: `expires_at` is cleared and
`granted_at` / `granted_by` are restamped on the existing row, instead of
deleting it and inserting a fresh one. Two reasons. A second insert would
leave two `read` rows for one contact, and `hasReadGrant` takes
`executeTakeFirst()` with no ordering — so which grant answers the gate would
depend on what the database felt like returning. And `granted_at` on
`access_grants` is written by exactly one line and read by nothing, so
restamping costs no information: it makes the row say when the owner actually
decided, which for a lapsed grant is the honest answer.

**Found next door and captured, not absorbed: B161.** `approveTripPlaces`
(`lib/tripPeople.ts:286`) has the identical defect in `trip_people` — it
selects the rows to open with `granted_at is null`, so an expired place is
passed over while its own readers three lines above already run `grantIsLive`.
Same rule, different table, so it is a separate id rather than an extra hunk
here.

Worth stating for whoever verifies: this is still unreachable in production.
Nothing writes a non-null `expires_at` to either table, so the test reaches
into the row directly, exactly as the B41/B82 expiry case beside it does. The
value is that the writer now agrees with the readers *before* the first
time-limited invitation ships, rather than after somebody spends an afternoon
on why approve does nothing.

## Acceptance

- A contact whose `read` grant has `expires_at` in the past, put back through
  `approveContact`, holds a live grant afterwards — `contactsWithReadGrant`
  contains them, `mayReadTrip` opens the journal's `guest` trips, and
  `subscribersFor` includes their subscription.
- A test in `test/access-gate.test.ts` or `test/contacts.test.ts` that fails
  before the change, reaching into the row the way the expiry case in
  `test/access-gate.test.ts` already does.
- The four checks.
