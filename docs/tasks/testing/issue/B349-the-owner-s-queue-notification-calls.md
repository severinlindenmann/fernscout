---
id: B349
title: The owner's queue notification calls a buddy a follower, naming neither the link kind nor the trip
type: ISSUE
priority: medium
complexity: low
area: mail
found: "2026-09-04T19:57:11Z"
started: "2026-09-04T20:02:32Z"
merged: "2026-09-04T20:17:06Z"
---

# B349 — The owner's queue notification calls a buddy a follower, naming neither the link kind nor the trip

## Why

`content/locales/en.json:105` — `contact.mailRequestBody` is
`"{name} ({email}) confirmed their email address and would like to follow
along."`, sent to the owner whoever the person is and whichever link they used.

Somebody who opened a **buddy** link is asking for write access to a trip. The
owner's mail calls it following along, names no trip, and names no link kind —
so the decision it is nudging them toward looks smaller than it is. The owner
may well approve straight from the mail's mood without reading the page.

The contacts page itself gets this right: "Came via — A link for someone to
write · the trip Down the Balkan line". The mail has the same rows available
and says none of it.

## Work

Give the request mail the same two facts the contact row already shows: which
kind of link, and which trip when there is one.

## Acceptance

Redeem a buddy link. The owner's notification says a write link and names the
trip. Redeem a guest link: it reads as it does today.
