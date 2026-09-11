---
id: B1270
title: The account page quotes send prices for nought people and offers to sell 5 GB to a journal using one kilobyte
type: ISSUE
priority: low
complexity: low
area: account page
found: "2026-09-10T10:11:45Z"
started: "2026-09-11T15:47:58Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:47:58Z"
---

# B1270 — The account page quotes send prices for nought people and offers to sell 5 GB to a journal using one kilobyte

## Why

`/<user>/account` on a journal one day old, at 390px:

> **Storage** — 1 KB of 5.0 GB used
> ● Everything else 1 KB   ● Bern Weekend 0 KB
> **[ Add 5 GB for 50 credits ]**
>
> **Payment** — 9 CREDITS
> WHAT ONE SEND WOULD COST NOW
> ✉ Email — up to **0 people** · free                    [toggle, on]
> 💬 WhatsApp — up to **0 people** · **0 credits**       [toggle, on]
> One published day — 0

Three separate things are being reported about nothing:

- A **two-slice breakdown of one kilobyte**, with a legend, under a bar that
  cannot render 1 KB of 5 GB as anything but empty.
- An offer to **sell 5 GB for 50 credits** — five times the whole signup grant —
  to somebody using 0.00002% of what they already have. On a balance of 9 it is
  also unaffordable, so the button is an advertisement that cannot be taken up.
- A **price list for sending to nought people**, with two toggles switched on
  and a "0 credits" quote, on a journal that has no readers yet.

This is the same shape as B1260 on the trip page: every module renders in full
ceremony whether or not it has anything to say, and the state it looks worst in
is the one every new journal starts in. It is the second page a person reaches
from the helper's own credit warning, so it is on the path B1269 describes.

## Work

- Decide what each block does when there is nothing to report. The storage
  breakdown wants a floor before it is worth drawing; the send prices want at
  least one recipient; the storage upsell wants a usage threshold.
- "up to 0 people · 0 credits" is worth replacing with the sentence that is
  actually true — nobody is signed up to read this journal yet — and a link to
  the invitations, which is the thing the person would want next.

## Acceptance

- A journal with no readers and no photographs shows no price quoted for nought
  people and no offer to buy storage.
- A journal with readers and content is unchanged.
