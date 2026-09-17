---
id: B1823
title: A contacts import stops at staged and sends the person to the agent
type: FEATURE
priority: high
complexity: medium
area: contacts, import
found: "2026-09-16T19:34:59Z"
---

# B1823 — A contacts import stops at staged and sends the person to the agent

## Why

The contacts import stages a vCard and stops. `components/extract/NonPhotoImport.tsx`
then tells the person to go to `/agent` and finish there — a dead end dressed as
a hand-off, in a flow whose whole premise is that the page does the job.

The parser is real (`importers/contacts/vcard.ts`, `lib/contacts/readImport.ts`).
The gap is that `readContactsFile` is reachable only through the bearer-token
`POST /api/v2/<user>/import`, which an owner's browser session cannot use. The
component's own doc comment documents this honestly.

Design and screen copy: `docs/plans/2026-09-16-import-onboarding.md`.

Related: B1571.

## Work

Build the cookie-authenticated twin of the bearer route, calling the same
reader and the same contact-request logic. Then replace the dead end with the
two screens:

**Peek** — a table of name, email and phone. Show which already exist (ticked,
disabled). Show **which have no email address and therefore cannot be added**,
greyed, with the reason inline. **Never silently drop a row**: somebody who
exported seven people and sees three must be told what happened to the other
four. Handle the case where nobody on the card has an address.

**Decide** — per person, guest or buddy, and which trips. Then state plainly
what the button does: each person gets one mail asking whether they want
anything from this journal, and until they answer they receive nothing else.
Button named after the action: "Add 3 people and send their confirmations".

Reuse the existing `agent.tool.contactsImport*` locale copy where it fits — it
is already correct and already translated.

An invite creates a request, not access. The copy must not imply otherwise.

## Acceptance

- A vCard can be taken from upload to contacts existing, entirely in a browser,
  with no `/agent` detour.
- Rows without an email address are shown with the reason, not dropped.
- Nothing is written and no mail is sent before the final button.
- Verified in a real browser with a real test vCard.
- `npm run verify` passes.

## Revised 17 September 2026 — this is the *Who was there* studio flow

Per `docs/plans/2026-09-17-the-studio.md`, this becomes a flow inside the studio
(B1829). Keep it distinct in the hub from B1833's *Invite a reader*: this one is
who was on the trip, that one is who may read it. Conflating them is how
somebody accidentally grants reading rights to an address book.
