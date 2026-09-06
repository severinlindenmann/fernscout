---
id: B601
title: A reader refused at the trip gate has no way to ask the owner to let them in
type: FEATURE
priority: medium
complexity: medium
area: contacts, ui, mail, i18n
found: "2026-09-06T14:40:35Z"
started: "2026-09-06T14:44:16Z"
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
carries nothing but that address and a name; and it is only offered from the
refused state, never before sign-in. B37's objection was the junk that follows
a public form asking for postal addresses, not the queue itself.

## Work

Built as written, with three things learned on the way.

- A button in the signed-in-and-refused branch of `TripGate`
  (`components/AskToBeLetIn.tsx`). Not in the signed-out branch, and **never a
  response to the address typed into the sign-in form** — `/api/auth/request`
  mails a code to any address on earth precisely so that the form cannot be
  asked who reads this journal, and branching on "not yet registered" at that
  point rebuilds the oracle. The ask is available after a session exists, to
  everyone, whether or not the address is known.
- `POST /api/contacts/ask`: takes the session's address through
  `journalReader` — which asks `resolveAccess`, so an instance-wide identity
  cookie counts too — plus a name, and writes a `pending` row with
  `createdVia: "asked"`. **No second six-digit code**, because
  `confirmContactFromSession` already exists for exactly this (B33): the
  session was minted against a code mailed to that address. Rate-limited five
  per quarter-hour per IP, like its neighbours.
- **A name is asked for, and refused when empty.** Not in the original Work
  section. `/api/contacts/redeem` refuses a nameless request for a reason that
  applies here word for word — the owner is about to decide about a person,
  and a row with no name on it is a decision they cannot make. A reader this
  journal already knows keeps the name on file and need not retype it.
- **One answer for every outcome** — `202 {"status":"accepted"}` for a new
  row, a row already waiting, a row already approved and a blocked address.
  The Work section had this returning `waiting` or `in`; `in` turned out to be
  unreachable except for an expired grant, where it would have been false, so
  there is one answer and no branch.
- The owner gets the existing contact-request mail with its own wording:
  `notifyOwnerOfRequest` already picks its body by kind (plain vs buddy), and
  `asked` is a third. Approving is the existing button; the welcome mail
  carries the self-serve link where postal details are filled in, so **no new
  invite link is needed** — an approval is the access link.
- Nothing is disclosed that the refusal did not already disclose. Same page,
  an acknowledgement, no mention of whether the owner has ever heard of them.
- **`private` trips are not covered.** A journal guest refused a `private`
  trip (B300, `gate.privateBody`) has already been let in to the journal;
  approving them again changes nothing, so that branch keeps its wording and
  gets no button.
- Off with the `contacts` capability — the button is absent, the endpoint 404s.
- i18n for every string, all three locales, and `npm run i18n:keys` re-run.
- `createdVia: "asked"` renders in `ContactsAdmin` as its own provenance.
- **The recorded decision is amended where it is written down**, which B37's
  own Work section asked for and which this task did not: the header table in
  `lib/contacts/invites.ts` now has a section saying a link is no longer the
  only way onto the queue, and what is different about the one that is not a
  link. `lib/journals.ts`'s "an invite link is now the *only* way to let
  anybody into a journal" was the other sentence that had quietly stopped
  being true.

Not done, and deliberately: no free-text note beside the name (the queue shows
a name and an address, and a message field is a mail-shaped hole in a form
strangers can reach), and no button on the teaser card at `/<user>/trips` —
the card links to the trip, and the trip is where the gate is.

## Acceptance

Every line below has evidence in `test/ask-to-be-let-in.test.ts` (9 tests) and
`test/trip-gate-copy.test.tsx` (3 added), and `npm run verify` passes whole:
290 files, 3731 tests.

- Signed in as a stranger on a `guest` trip's gate: a button appears, pressing
  it puts one `pending` row on the owner's contacts page marked as having
  asked, and mails the owner. Pressing it twice adds nothing and answers the
  same. — *"is put in the owner's queue, confirmed, and granted nothing"*,
  *"pressing it twice does not put a second request in front of the owner"*,
  *"can ask to be let in from the page they are standing on"*.
- Approving that row from the contacts page opens the trip on the next load,
  with no invite link sent and no second code. — *"issues no six-digit code"*;
  the approval half is `approveContact`, unchanged and already covered by
  `test/access-gate.test.ts`.
- Signed out on the same gate: no button, and the page is unchanged. —
  `TripGate`'s signed-out branch is untouched, and the endpoint answers 401
  (*"there is nothing to ask with"*).
- A journal guest refused a `private` trip: no button. — *"is offered no way to
  ask again"*.
- `contacts` off: no button, and the endpoint answers 404 like its neighbours.
  — *"the door is absent rather than broken"*, *"is not offered the button when
  this journal keeps no contacts"*.

Two more the acceptance section did not ask for and that matter more than some
that it did: *"takes the address off the session and never out of the body"*
(nobody can put a third party in front of the owner) and *"answers the same for
a blocked address as for anybody else"*.

## What a person should look at

Sign in to a journal as an address with no access, open a `guest` trip, and
press the button; then look at `/<user>/contacts` for the row and at
`content/<user>/mail/` for the two letters (a dev server writes `.eml` files
rather than sending). The wording is the part no test can check: `gate.askBody`
and `gate.askSent` have to promise nothing, and `contact.mailRequestAskedBody`
has to tell the owner that this person was not sent a link.
