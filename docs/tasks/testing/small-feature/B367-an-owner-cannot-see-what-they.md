---
id: B367
title: An owner cannot see what they have left to spend or what one send would cost
type: FEATURE
priority: medium
complexity: medium
area: credits, me page
found: "2026-09-04T21:03:00Z"
started: "2026-09-04T21:18:33Z"
merged: "2026-09-04T21:46:08Z"
---

# B367 — An owner cannot see what they have left to spend or what one send would cost

## Why

B366 makes a send cost credits and refuses it at zero. Nothing shows the
balance. An owner about to publish has two questions — *how many do I have* and
*what will this cost me* — and the only way to answer either is a shell on the
server.

The second question is the one with teeth. "One credit per email" is not a
price an owner can act on: the number that matters is how many contacts are
**approved and opted in to that channel right now**, which changes every time
somebody joins or unsubscribes, and which the owner has no view of anywhere.
Somebody who thinks they have twelve readers and has forty finds out by being
refused, or by spending forty.

## Work

A **Payment** section on `/<user>/me`, in `MePageContent.tsx`, inside the
existing `{viewer.owner && …}` block (`app/[user]/me/MePageContent.tsx:317`)
and additionally gated on `isEnabled("credits", user)`. Absent, not disabled,
when the capability is off — B74's rule, and the same reason the contacts
button at `:380` is absent rather than greyed.

It shows:

- **Balance.** The number, and the plain sentence that at zero nothing sends.
- **Prices.** 1 credit per email, 1 credit per WhatsApp message. Flat, and
  stated as such so a reader is not left wondering what varies.
- **What one send costs, now.** Two counts — opted-in email recipients and
  opted-in WhatsApp recipients — and the credits a full send to each would take.
  Both are `recipientsFor`'s answer, not a fresh count: reuse B366's
  `wouldCost` / `recipientsFor` rather than re-deriving "who is opted in" on a
  page. A third copy of that predicate beside `mayMailTrip`'s two is how the
  panel and the charge start disagreeing, and `dayLetter.ts`'s own doc comment
  is already an essay about exactly that.

  Note the honest caveat in the copy: this is the count for a **public** trip.
  A `private` trip reaches fewer people, because `mayMailTrip` filters per
  recipient. Say "up to N" rather than asserting a number the next send will
  not match.

- **Buy credits** — B368's button. Ship this ticket with it absent or inert;
  they are separate tickets on purpose so the panel is useful before the
  overlay exists.

### Where the numbers come from

Server-side, in `app/[user]/me/page.tsx`, alongside the existing `manage` and
`contactsEnabled` resolution (`:44`–`:83`), and passed down as one prop — the
same rule that block already follows: *the field is chosen at the server
boundary rather than in the component, so that a later edit to the component
cannot leak a value it was never handed.* Counts and a balance cross that line.
Names, addresses and telephone numbers do not.

Do **not** add an API route for the balance. The page is already server-rendered
per request and `viewer.owner` is already resolved there; a route is a second
owner-gate to get wrong, and B240 is open on precisely that class of bug.

### Not in this ticket

- The buy overlay and the purchase mail — B368.
- WhatsApp's count is `0` until B369 lands; render the row only when
  `isEnabled("whatsapp", user)` so it does not read as "nobody wants WhatsApp".
- Per-trip cost estimates, spend history, a ledger view. `npm run credits --
  list` covers the operator's need; a reader-facing history is speculative.

## Acceptance

- `npm run verify` green.
- New cases in `test/access-panel.test.tsx` (or a sibling):
  - The Payment section renders for the owner and **not** for a signed-in
    guest, a traveller, or a reader with no session — asserted on the rendered
    output, not on a prop.
  - With `credits` disabled it renders for nobody, owner included.
  - The recipient count matches what `recipientsFor` returns for the same
    fixture, so the panel and the charge cannot drift.
- By hand on `fernscout.ch/example/me`: the balance shown equals `npm run
  credits -- list example`, and the email count equals the number of contacts
  that are `active` with `wantsEmailDigest`.
