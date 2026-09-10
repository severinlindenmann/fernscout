---
id: B1301
title: An approved reader who opens a buddy link is given write access to the trip with no owner decision, and told there is nothing to do
type: SECURITY
priority: high
complexity: medium
area: invites, contacts
found: "2026-09-10T11:19:51Z"
---

# B1301 — An approved reader who opens a buddy link is given write access to the trip with no owner decision, and told there is nothing to do

## Why

`lib/contacts/invites.ts:60-76` states the invariant three times, in its own words:

> **holding a link is still not access.** A guest link and a buddy link both end
> at a `pending` contact and **an owner deciding by hand**. … `approveContact` is
> still the only thing in the codebase that writes a grant.

Driven on fernscout.ch, 2026-09-10, that is not what happens when the person
opening the buddy link is already an approved **reader**.

### The sequence

1. Bea is invited as a guest, confirms her address, and the owner's approval makes
   her `status: active` — **read access to the journal's `guest` trips, nothing
   more**. Her `relationship` is `{guest: true, buddyOf: []}`.
2. The owner issues a buddy link for `bern-weekend-2026`.
3. Bea opens it, signed in as herself. The page says:

   > **Come along on Bern Weekend** … This doesn't let you in on its own —
   > somebody has to say yes first.
   > **[ Yes, that's me ]**

4. She presses it. The page answers:

   > **You're already in** — Nothing left to do.

5. Her relationship is now
   `{guest: true, buddyOf: [{id: "bern-weekend-2026", title: "Bern Weekend"}]}`.
   The invite reads `uses: 1`. **Nothing appeared in the owner's "Waiting for
   you"**, and the owner was never asked.

### It is real write access, not a label

Requested a trip-scoped agent token as her, and wrote a day into the owner's trip:

```
POST /api/auth/verify  {"email":"bea-test@…","kind":"agent","trip":"bern-weekend-2026"}
  → fs_agent_…
POST /api/v1/test-mobile/trips/bern-weekend-2026/days  → 201
  {"ok":true,"slug":"written-by-a-reader-who-was-never-approved-as-a-buddy",
   "status":"draft"}
```

Every refusal before that one was a *field validation* error, never a 401 or 403 —
authorisation passed on the first attempt. The day was removed from disk after the
check.

### Why it matters

The owner's approval of Bea was a decision about **reading**. The buddy link turns
it into a decision about **writing**, without the second decision the module says
is required, and the screen tells the person there is nothing to decide — so
neither party ever sees the escalation happen.

A buddy link is a URL. AGENTS.md warns it is "not the one to paste into a group
chat" precisely because forwarding matters; the approval queue is what makes that
warning survivable. For anybody already approved to read, it does not apply.

**Not claimed:** that a stranger gets anything. An unapproved address still lands
in the queue — that path was checked and holds. This is specifically the
already-approved reader.

## Work

- Decide whether an existing guest grant should satisfy a buddy link. If it
  should, the module comment and AGENTS.md are wrong and must be corrected — a
  documented invariant that the code does not keep is worse than either.
- If it should not, the redemption needs its own pending row for the trip, and the
  page must not say "You're already in" about a grant the person does not have.
- Whichever way it goes, `test/` should carry it: approved guest opens buddy link
  → assert what `relationship.buddyOf` contains.

## Acceptance

- An approved reader opening a buddy link either lands in the owner's queue, or
  is told plainly what they have just been given.
- No screen says "nothing left to do" while a grant is being written.
- The behaviour and `lib/contacts/invites.ts`'s comment agree.
