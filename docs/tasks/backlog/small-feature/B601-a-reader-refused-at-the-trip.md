---
id: B601
title: A reader refused at the trip gate has no way to ask the owner to let them in
type: FEATURE
priority: medium
complexity: medium
area: contacts, ui, mail, i18n
found: "2026-09-06T14:40:35Z"
related: B37, B117, B300, B587
---

# B601 — A reader refused at the trip gate has no way to ask the owner to let them in

## Why

`TripGate` (`components/TripGate.tsx`) has four states and every one of them
is a dead end for somebody who genuinely should be let in. A reader signs in,
proves their address, and is told *"ask whoever writes this journal to let you
in"* — with no way to ask from the page they are standing on. Asking means
knowing who the owner is and having another channel to reach them. A teasered
trip (B587) makes this worse on purpose: it advertises a trip's existence to
somebody who then has nothing to press.

The owner's side already exists and works. `requestContact` writes a `pending`
row, `approveContact` is the only thing that grants, and the contacts page is
the queue. What is missing is the doorway, and B37 is why it is missing: the
open form at `/<user>/join` was removed because *the journal advertised a way
in its owner never offered* — a standing public form asking strangers for a
name, an email and a postal address.

**This is not that door, and the difference is the whole task.** The reader is
already signed in and their address is already proven by the session; the ask
carries nothing but that address; and it is only offered from the refused
state, never before sign-in. B37's objection was the junk that follows a public
form asking for postal addresses, not the queue itself.

## Work

- A button in the signed-in-and-refused branch of `TripGate`: *"Ask to be let
  in"*. Not in the signed-out branch, and **never a response to the address
  typed into the sign-in form** — `/api/auth/request` mails a code to any
  address on earth precisely so that the form cannot be asked who reads this
  journal, and branching on "not yet registered" at that point rebuilds the
  oracle. The ask is available after a session exists, to everyone, whether or
  not the address is known.
- `POST /api/contacts/ask` (or a flag on the existing request route): takes the
  session, no body but an optional one-line note, writes a `pending` contact
  row for the session's address with `createdVia: "asked"` and
  `confirmed_at` already set — the address was proven by the code that made the
  session, so do not send a second six-digit code. Rate-limited like
  `contacts-request`, and uniform `202` whatever the row's state already was.
- The owner gets the existing contact-request mail, worded for this case: this
  person asked to be let in, here is the queue. Approving is the existing
  button; the welcome mail already carries the self-serve link where they fill
  in postal details, so **no new invite link is needed** — an approval is the
  access link. Reserve issuing an invite for the case where the owner wants to
  hand it to somebody else.
- Do not tell the requester anything the refusal did not already tell them.
  Same page, an acknowledgement, and no mention of whether the owner has ever
  heard of them.
- **`private` trips are not covered by this.** A journal guest refused a
  `private` trip (B300, `gate.privateBody`) has already been let into the
  journal; approving them again changes nothing, so that branch keeps its
  current wording and gets no button.
- Off with the contacts capability, and the button absent rather than broken.
- i18n for every string, all locales.
- `createdVia: "asked"` shows in `ContactsAdmin` as its own provenance —
  `components/ContactsAdmin.tsx:167` already renders the three existing values.

## Acceptance

- Signed in as a stranger on a `guest` trip's gate: a button appears, pressing
  it puts one `pending` row on the owner's contacts page marked as having asked,
  and mails the owner. Pressing it twice adds nothing and answers the same.
- Approving that row from the contacts page opens the trip on the next load,
  with no invite link sent and no second code.
- Signed out on the same gate: no button, and the page is byte-identical to
  today's.
- A journal guest refused a `private` trip: no button.
- `contacts` off: no button, and the endpoint answers 404 like its neighbours.
