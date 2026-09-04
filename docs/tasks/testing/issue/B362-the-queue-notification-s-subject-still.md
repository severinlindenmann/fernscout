---
id: B362
title: The queue notification's subject still calls a buddy a follower, though its body no longer does
type: ISSUE
priority: low
complexity: low
area: mail
found: "2026-09-04T20:17:06Z"
started: "2026-09-04T21:24:46Z"
merged: "2026-09-04T21:42:57Z"
---

# B362 — The queue notification's subject still calls a buddy a follower, though its body no longer does

## Why

B349 fixed the body of the owner's queue notification: a buddy redemption now
reads "... is asking to write to Down the Balkan line." The subject line was
not touched and still reads:

> Someone would like to follow The Lifecycle Journal

Observed 2026-09-04 on fernscout.ch after B349 was deployed (8f36107). The
subject is what the owner sees in a mail list, and it is the half that still
describes somebody asking for write access as a follower -- which is the whole
of what B349 was about.

## Work

Give the subject the same buddy variant its body already has. The locale keys
sit beside each other; `contact.mailRequestBuddyBody` is the model.

## Acceptance

Redeem a buddy link. The owner's notification subject does not call them a
follower. A guest redemption's subject is unchanged.
