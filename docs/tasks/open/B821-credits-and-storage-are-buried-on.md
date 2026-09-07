---
id: B821
title: Credits and storage are buried on the account page with everything else
type: FEATURE
priority: medium
complexity: medium
area: account, credits, storage
found: "2026-09-07T17:40:00Z"
---

# B821 — Credits and storage are buried on the account page with everything else

## Why

Asked for: *"move Guthaben and Speicherplatz together on their own page and
menu point."*

Both live on `/[user]/me` today (`app/[user]/me/MePageContent.tsx`), stacked in
among the owner's contact details, the journal's title and tagline, the device
list and the access panel. They are the two questions an owner asks
repeatedly and urgently — *how much can I still spend* and *how much room is
left* — and they are the two that answer with a number rather than a form.
Reaching them means scrolling past everything else on the one page that holds
everything else.

They also belong together in a way the rest of that page does not: since B661
storage is bought *with* credits, 5 GB at a time. Two readings of the same
account, on one page, is the shape.

## Work

- A page of their own under `/[user]/`, and a destination in `useNavEntries()`
  (`components/SiteNav.tsx`) so it is reachable from the menu like the others.
- Move the credits panel and the storage panel off `/me`, do not copy them —
  two live copies of a balance is how they disagree.
- Leave a way through from `/me`, since that is where people have learnt to
  look. A line and a link, not the panels again.
- Owner-only, the same gate `/me` already uses. `credits` is an operator-level
  capability (`lib/capabilities.ts`) and may be off: with it off the page shows
  storage alone rather than a broken half.
- Both figures already exist behind `GET /api/v1/<user>/status` and
  `.../storage`; read them the way `/me` does rather than inventing a route.

Not doing: changing what a credit costs, the buying flow, or the quota rules.
This is where the two panels live.

## Acceptance

- The nav has a destination that opens a page carrying both figures.
- `/me` no longer renders either panel, and still points at them.
- With `credits` off, the page is storage alone and nothing is broken.
- A reader who is not the owner cannot open it.
- Checked at 390px.
