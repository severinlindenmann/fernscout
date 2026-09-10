---
id: B1356
title: The owner cannot select themselves as a postcard recipient
type: ISSUE
priority: medium
complexity: low
area: postcards
found: "2026-09-10T17:58:05Z"
superseded: "Already works — B619/B621. The owner adds their own contact row on /<user>/contacts (the *your details* card, created active and approved), enters their address and ticks the postcard consent on the same manage form every reader gets (app/api/contacts/manage). eligible() in lib/postcard/contacts.ts then includes them like anyone else — recipients list, helper, order page and send all route through it. No code change needed."
---

# B1356 — The owner cannot select themselves as a postcard recipient

## Why

Reported as "make sure the owner can select themselves when sending a
postcard". Investigation showed the gate is `eligible()` in
`lib/postcard/contacts.ts` (active + wantsPostcard + postable address), and
the owner clears it the same way any reader does.

## Work

None — B619 gave the owner their own contact row (`self` action in
`app/api/contacts/admin/route.ts`), created active, with the same consent
form as everybody else. Ticking "wants a postcard" there with an address is
sufficient.

## Acceptance

On /<user>/contacts, the owner's own row with an address and the postcard
consent ticked appears in `GET /api/v1/<user>/postcards/recipients`.
