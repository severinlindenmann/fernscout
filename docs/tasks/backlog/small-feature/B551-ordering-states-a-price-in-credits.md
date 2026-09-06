---
id: B551
title: Ordering states a price in credits and leaves the rest to be inferred
type: FEATURE
priority: high
complexity: medium
area: photobook, order, ux
found: "2026-09-06T09:04:24Z"
---

# B551 — Ordering states a price in credits and leaves the rest to be inferred

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

See B547. The order step is the last screen of the flow and it says:

```
32 pages in 1 volume(s)
154 credits
You have 0 credits
[Pay with credits]   (disabled)
This book costs 154 credits and you have 0.
```

The number is stated three times and explained none. A reader does not know
what a credit is worth, what the book costs in money, what they get, or what
happens after the button. There is no way to obtain credits from here. The
disabled button is the end of the road.

What actually happens after paying — an order, an email, a PDF — is nowhere on
the screen before the decision.

## Work

Say what is being bought, what it costs in something a person understands, and
what will happen. What the book is (size, pages, binding, in words), the price,
and — since credits are the unit — what that is in money at the current rate.
Where to get more when there are not enough, rather than a dead disabled button.

Then say what follows: this is a dry-run pipeline that produces a PDF by email
and prints nothing. **That must be honest on the screen** — B434's rule for
postcards is that an agent must never report a proposal as a sent thing, and the
same applies to a page. Do not imply a book will arrive.

Check what the receipt mail actually says while you are here; it is the last
thing in the flow and nobody has read it recently.

**Not doing:** a real payment provider, or Gelato. Still simulation.

## Acceptance

- Before pressing, the screen says what the book is, what it costs in money as
  well as credits, and what will happen next.
- Not having enough credits leads somewhere, not to a disabled button alone.
- Nothing on the screen or in the mail implies a printed book is coming.
