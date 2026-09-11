---
id: B1282
title: A guest confirming their invitation silently deletes the postal address the owner entered for them
type: ISSUE
priority: high
complexity: medium
area: contacts
found: "2026-09-10T10:45:41Z"
started: "2026-09-11T12:32:28Z"
merged: "2026-09-11T12:50:57Z"
completed: "2026-09-11T13:18:30Z"
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

Built, after the identity judgement in "What was built" below:

- `app/api/contacts/redeem/route.ts`: `known` (already looked up by email a
  few lines above, for the name) is now also consulted before deciding
  `addressProvided`. A wholly blank `address` object is treated as "not
  answered" — same as the confirm step already treats a signed-in reader —
  whenever that email already has a stored address, so it can never again be
  read as "delete this". Typing even one field is still always honoured, so
  correcting or deliberately clearing what is on file still works. This half
  applies unconditionally, including to a hand-built request: it never
  returns an address to anybody, so there is nothing to disclose by fixing
  it everywhere.
- `app/[user]/invite/redeemPage.tsx`: looks up the existing contact by email
  **only** when `invite.email` is set — a link the owner asked the server to
  mail to a named address, the same condition B338 already gates the email
  prefill on — and passes its address and `wantsPostcard` to `InviteRedeem`
  as `initialAddress` / `initialWantsPostcard`. A hand-copied link gets no
  lookup and no prefill, unchanged from before.
- `components/InviteRedeem.tsx`: the two new optional props seed the
  existing `address` and `wantsPostcard` state instead of always starting
  blank.
- `test/invite-links.test.ts`: a round trip — owner writes an address via
  `requestContact`, guest redeems with a wholly blank form, address and
  consent survive — plus a no-regression case (brand-new email, blank
  submission, still stores nothing) and a correction case (typing a new
  address over a stored one still updates it).
- `test/invite-redeem-address.test.tsx`: the UI half — given
  `initialAddress`/`initialWantsPostcard` the fields and the postcard box
  render prefilled; given neither, they render exactly as blank as before.

## Acceptance

- Owner adds a guest with a postal address and postcard consent; guest confirms
  through the invitation; both are still there afterwards.
- A guest who deliberately clears their address still can.

## Decision, 2026-09-11

**Show her the stored address, prefilled, so she can correct it.** Chosen over
hiding it and silently preserving it: it is her own postal address, and hiding
data about somebody from themselves is worse than showing it. The blank form
claiming no address exists is part of what makes this bug silent in the first
place.

Verified before deciding — the cause is narrower than the ticket's prose
suggests. `knownEmail` (`app/[user]/invite/redeemPage.tsx:104`) is set **only**
from a session cookie for this journal, and is never informed by whether a
`contacts` row already exists for that address. So a guest opening an invitation
for the first time, with no prior session, always lands on `step: "form"`
(`components/InviteRedeem.tsx:137`) however much the journal already holds about
her. `redeemPage.tsx` passes no `initialAddress` or `initialWantsPostcard` at
all — only `initialName`. `redeem()` then always sends both fields, blank, and
`app/api/contacts/redeem/route.ts:257` computes `addressProvided` as true
because there is no session, so `hasAnyDetail(mergedAddress)` is false in
`lib/contacts/index.ts:273-283`, `cipher` becomes null, and the encrypted
address is wiped.

So the server fix is to know about the existing row **without** a session —
look up by email before deciding `addressProvided` — and the UI fix is the
prefill. Both halves, not one.

## What was built

**Judgement call, made with the code in front of me:** holding the link alone
does **not** prove the opener is the address's owner — the guest link is
never bound to one address, and even a mailed one only carries what the
recipient already read once in their own inbox. So the two halves are not
symmetric in what they may disclose:

- **The server-side "do not wipe" fix applies unconditionally**, because it
  never puts the address on a wire anywhere — it only decides what
  `requestContact` writes. `app/api/contacts/redeem/route.ts` (`formStep`,
  `submittedRaw`, `addressProvided`, just before the existing "digest tick"
  comment) now looks up the existing contact by email (reusing `known`,
  already fetched a few lines above for the name) and treats a wholly blank
  `address` object as "not answered" — same as the confirm step already
  treats a signed-in reader — whenever that email already has a stored
  address. A submission with so much as one field in it is still always
  honoured, so correcting or deliberately clearing what is shown still works.
  A brand-new address is unaffected: nothing on file, so nothing to
  preserve, exactly as before.
- **The UI prefill is the narrower design, gated on the same "already read it
  once" reasoning B338 already uses for the email field** —
  `app/[user]/invite/redeemPage.tsx` looks up the contact **only** when
  `invite.email` is set, i.e. only for a link the owner asked the server to
  *mail* to a named address, and passes its `postalAddress` /
  `wantsPostcard` to `InviteRedeem` as `initialAddress` /
  `initialWantsPostcard`. A hand-copied guest link (`invite.email` null)
  gets no lookup and no prefill — precisely because holding it proves
  nothing about whose address is on file, and printing somebody else's
  street back to whoever opens a forwarded link would be a new disclosure
  the rest of this codebase does not license. `components/InviteRedeem.tsx`
  wires the two new optional props into the existing `address` /
  `wantsPostcard` state.

So this is not the fully general "show her the stored address" for every
opener the ticket's decision reads as — it is that design **restricted to
the case the codebase already treats as safe to disclose to**, plus the
narrower "never silently wipe" protection everywhere else, including a
hand-copied link and a hand-built request.

**Test:** `test/invite-links.test.ts`, new describe block "B1282 — a first
redemption must not wipe an address already on file" — writes an address via
`requestContact` directly (the owner's side), then redeems a fresh guest
link with a wholly blank `address` and `wantsPostcard: false` for that same
email, and asserts the address and the consent survive; a sibling case checks
a genuinely brand-new email's blank submission is unaffected (still stores
nothing), and another checks that typing even one field still corrects the
stored address. Confirmed the first case fails on the unfixed route (`git
stash` on `route.ts` alone, no other changes) with `expected undefined to be
'Teststrasse 2'`, then restored the fix and re-ran green.
`test/invite-redeem-address.test.tsx` adds the UI-only half: given
`initialAddress` / `initialWantsPostcard`, the fields and the postcard box
render prefilled; given neither, they render exactly as blank as before.

`npm run verify` passed in full (build, tsc, eslint, 522 files / 6869 tests,
knip) on this branch.

## Accepted as shipped, 2026-09-11

The owner was asked whether the narrower reading was what they wanted, with the
wider one offered, and chose narrow.

So this is the settled shape: the server-side no-wipe is **unconditional**, and
the **prefill happens only when `invite.email` is set** — a link the owner had
the server mail to a named address. A hand-copied or forwarded link gets no
lookup and no prefill, because holding a guest link does not prove whose address
it is, and `lib/contacts/invites.ts` says as much itself.

Not a compromise reached for lack of a decision: the decision was taken with the
trade in front of it.
