---
id: B1282
title: A guest confirming their invitation silently deletes the postal address the owner entered for them
type: ISSUE
priority: high
complexity: medium
area: contacts
found: "2026-09-10T10:45:41Z"
---

# B1282 — A guest confirming their invitation silently deletes the postal address the owner entered for them

## Why

Driven end to end on fernscout.ch, 2026-09-10:

1. The owner opens `/<user>/contacts` → **Add a guest**, enters Bea Muster, her
   email, ticks **Wants a real postcard from the road**, and types her street,
   town and country. Saved. `GET /api/contacts/admin` confirms:

   ```
   Bea Muster | pending | postcard: True | hasAddr: True |
     {line1: 'Teststrasse 2', city: 'Bern', country: 'CH'}
   ```

2. Bea gets the invitation mail and opens the link. Her confirmation form is
   prefilled with her name and email — and the **postal address fields are
   empty**, with **"Send me a real postcard from the road" unticked**. Nothing on
   the page says an address is already on file.

3. She presses **Confirm and join**, proves her address with the code, and is in.

   ```
   Bea Muster | active | postcard: False | hasAddr: False | None
   ```

The address is gone. So is the consent. Neither person was told: Bea could not
have known she was erasing anything, because she was never shown it, and the
owner sees a contact who is now approved and unpostable with no event marking the
change.

The failure mode is quiet and expensive in exactly the way that matters here —
the owner does the work of collecting an address, invites the person, the person
does the polite thing and confirms, and the address is destroyed by the
confirmation. The next thing the owner tries is a postcard, which will refuse.

**The mechanism is known.** `app/api/contacts/admin/route.ts:295` already
documents it, on the *other* path:

> Refuse rather than silently rewrite: `requestContact`'s existing-row branch
> overwrites locale and consents, **NULLs the postal address**, and this route is
> about to mail a fresh invitation — an owner typing an address they don't
> realise is already an approved guest would delete that guest's address…

The owner-create path was guarded with a `contact_exists` 409. The guest
confirmation path goes through the same `requestContact` existing-row branch and
was not.

## Work

- The confirmation should not null what it was not given. An empty address field
  on a form that never showed the stored address is not the person asking for it
  to be deleted.
- Decide what the guest sees. Showing them the address on file — it is theirs —
  and letting them correct it is the honest version; hiding it and preserving it
  is the minimum.
- The same question applies to the consents: `wantsPostcard` went from true to
  false by the same route.
- Whatever is chosen, `test/` should carry the round trip: owner writes an
  address, guest confirms, address survives.

## Acceptance

- Owner adds a guest with a postal address and postcard consent; guest confirms
  through the invitation; both are still there afterwards.
- A guest who deliberately clears their address still can.
