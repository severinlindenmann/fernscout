---
id: B1458
title: The order page does not say who the book is going to
type: FEATURE
priority: medium
complexity: low
area: photobook, the order page
found: "2026-09-11T12:35:07Z"
started: "2026-09-11T12:35:36Z"
merged: "2026-09-11T12:52:16Z"
---

# B1458 — The order page does not say who the book is going to

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`/<user>/photobooks/<id>` shows what the book is, its status, and its files —
and never says **who it is going to**. For an object bought printed and posted
(B1157), the recipient is half of what the order is.

The ordering panel already does this properly, one screen earlier:
`BookLevelView.tsx:381-395` renders an envelope — the name centred over the
whole address, because that is how an address is read and what somebody checks
a parcel against (B1145). The order page, which is the receipt for that same
purchase, drops it.

Seen on `https://fernscout.ch/severin/photobooks/9f1b3820-…`: format, status,
download, nothing about the recipient.

## Work

- Show the same envelope on the order page, reusing `addressLines` and the
  existing panel markup from `components/PhotobookPrintPanel.tsx` — those two
  helpers were deliberately kept when B1428 deleted the rest of that file, so
  there is nothing new to draw.
- Resolve it from `payload.print.contactId` via `bookAddressFor(owner, id)`,
  the same call the order route used when it priced the postage.
- Place it with the print status, not with the downloads: who it is going to
  and how the printing is going are the same question.

**This page is owner-only** — `isOwner` with a cookie session, no bearer token
(B1428's header refusal is still there). So the envelope is shown to the one
person who chose the recipient and already saw the address when they bought.
Nothing here widens who can read it, and nothing about the recipient may
travel any further: **an agent must still never see an address** (B434), and
this page answers no token.

- A contact removed or un-approved since the order should not break the page.
  Show what the order recorded, or nothing, rather than throwing.

**Not in this ticket.** No change to the ordering panel, to who may read the
page, or to what any API returns.

## Acceptance

- The order page names the recipient and shows the address, in the same
  envelope shape as the ordering panel.
- An order whose contact no longer resolves still renders.
- No API route gains an address.
- Checked in a browser at 390px.
- `npm run verify` clean.
