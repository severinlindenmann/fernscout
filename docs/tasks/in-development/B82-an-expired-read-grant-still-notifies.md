---
id: B82
title: An expired read grant still notifies, because push does not ask lib/grants
type: ISSUE
priority: medium
complexity: low
area: push, grants
found: "2026-09-01"
started: "2026-09-03"
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

### The import question, answered

**Yes — `lib/push.ts` may import `lib/grants.ts`, and the constraint it would
have broken is a different one.** The evidence, in the order it was checked:

- The constraint is named twice in `lib/push.ts` (lines 48 and 126) and it is
  specific: this file does not import **`lib/contacts`**. The reason is stated
  in the second of the two — resolving a contact's address here "would put
  decrypted addresses in the notify path". It is about the encrypted-PII
  module, not about the access model in general.
- `lib/grants.ts` is not that module and does not reach it. Its only import is
  `./db`, and the whole of `lib/db/` imports nothing but `kysely`, `node:fs`,
  `node:path`, `../dataDir` and its own siblings — enumerated with
  `grep -rho 'from "[^"]*"' lib/db | sort -u`. No `lib/contacts` module is in
  that closure. (`lib/db` *mentions* `lib/contacts/crypto.ts` in two comments,
  explaining that the column it declares is encrypted there; it does not import
  it.)
- `lib/grants.ts` selects `contact_id` and `expires_at` from `access_grants`
  and nothing else. No encrypted column — `name`, `email`, `postal` all live on
  `contacts` and it never touches that table. So a contact id, which
  `StoredSubscription` already carries, is the only thing crossing the line.
- The dependency also runs the right way round. `lib/contacts/session.ts`
  already imports `../grants`; `lib/grants.ts` imports nothing back. Adding
  this edge creates no cycle and pulls `lib/contacts` into nothing.
- The plan the comments cite, `docs/plans/W12-push.md`, **does not exist in
  this repository** — `docs/plans/` was removed on 2026-09-01 and is only in
  git history. That is already captured as B09 (and B23) and is not fixed
  here; the answer above is from the code, which is the surviving record.

The contact-status question stays a direct `contacts` table read in this file,
exactly as `findActiveContactId` does it, so nothing about the `lib/contacts`
constraint changed.

### What was built

- `subscribersFor` no longer queries `access_grants`. It asks
  `contactsWithReadGrant(trip.username, new Date())` for the whole fan-out.
- The per-subscription `contacts` lookup was hoisted alongside it, so the loop
  became **two queries in total** rather than two per subscription: one for the
  owner's `active` contact ids, one for the live grants, run concurrently. The
  body is now a `filter` over both sets, asking active-then-granted in
  `planDigest`'s order.
- The doc comment records why the import is allowed, so the next reader does
  not have to re-derive it.

### Found and not absorbed

- **B130** — `approveContact` guards its grant insert on the row existing, not
  on it being live, so re-approving a contact whose grant has expired writes
  nothing and the approval silently does nothing. The same "a row exists"
  mistake as this task, on the writing side. Latent for the same reason: no
  caller sets an expiry yet.

## Acceptance

- A subscription whose contact's grant has `expires_at` in the past is not
  notified about a `guest` trip — the case that fails today.
- The expiry row in `test/access-gate.test.ts` ("a grant that has expired is
  not a grant") covers push alongside the panel and the gate, in the same
  table.
- `subscribersFor` no longer queries `access_grants` itself.
- The four checks.

## Result

All four acceptance lines demonstrated; see the run notes below.

- **Expired grant is not notified.** `test/access-gate.test.ts` fails before
  the change with `expected [ 'https://push.example/approved' ] to not include
  'https://push.example/approved'` and passes after it.
- **The expiry row covers push.** "a grant that has expired is not a grant" is
  now titled *the panel, the gate and push all stop, together* and asserts all
  three off the one row, with a positive assertion before the update so it
  cannot pass by nobody being eligible.
- **`subscribersFor` no longer queries `access_grants`.**
  `grep -rn 'selectFrom("access_grants")' lib app scripts` returns only
  `lib/grants.ts` (twice) and `lib/contacts/index.ts:647` — and that last one
  is `approveContact`'s upsert guard, a writer, not a reader deciding access.
  Every *reader* of the table is now `lib/grants.ts`.
- **The four checks** all pass.
