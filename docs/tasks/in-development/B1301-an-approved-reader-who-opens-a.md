---
id: B1301
title: An approved reader who opens a buddy link is given write access to the trip with no owner decision, and told there is nothing to do
type: SECURITY
priority: high
complexity: medium
area: invites, contacts
found: "2026-09-10T11:19:51Z"
started: "2026-09-11T11:57:57Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T11:57:57Z"
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

## Decision, 2026-09-11 — first in the queue, and worse than described

**The invariant is not in question.** Every buddy redemption gets its own
pending decision; an existing guest grant does not satisfy a buddy link. Both
`lib/contacts/invites.ts:60-76` and AGENTS.md already assert this ("approveContact
is still the only thing in the codebase that creates a grant"), so weakening it
would have to be an argued product decision rather than a side effect of fixing
a bug.

**The mechanism, traced rather than assumed.** `claimTripPlace` at
`app/api/contacts/redeem/route.ts:322` is correct on its own — it writes a
*pending* `trip_people` row with `granted_at: null`. The escalation is two lines
later, at 362-367: `preapproved` is computed from
`confirmed.contact.createdVia`, which is the value stamped when the contact row
was **first** created and is never rewritten by `requestContact`'s update branch
(`lib/contacts/index.ts:285-299`). `preapprovedEmailFor`
(`lib/contacts/invites.ts:263-280`) therefore compares her current address
against the **original** invite's stored key — which matches for anybody
originally added through a mailed invitation, the ordinary path. On a match,
`approveContact` runs; it never checks that the contact was pending, and at
`lib/contacts/index.ts:879` it unconditionally calls `approveTripPlaces`, which
opens *every* pending row for that contact — including the one written moments
earlier in the same request.

That also explains both reported symptoms. She is told "You're already in" because
`status: "in"` is driven purely by `contact.status === "active"`, already true
from her earlier guest approval and nothing to do with this trip. The owner's
queue stays empty because the contacts page groups by `contact.status ===
"pending"`, and only the *trip* request was ever pending — and it is resolved
before the owner ever sees it.

**So the fix is to stop a decision made about one invite being read as a decision
about another.** A stale `createdVia` must not drive preapproval for an
already-active contact.

Not in scope, and captured separately if it matters: whether any contact on the
live instance currently holds a trip grant that arrived this way. A fix stops it
recurring and does not undo what has already happened.
