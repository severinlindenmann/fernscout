---
id: B595
title: A photobook can be charged a price the owner never saw
type: ISSUE
priority: low
complexity: low
area: photobook, credits
found: "2026-09-06T14:32:19Z"
started: "2026-09-07T11:40:40Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:40Z"
---

# B595 — A photobook can be charged a price the owner never saw

## Why

Found while working B482 (a photograph-less book paid for from a stale tab).
`app/[user]/photobook/order/route.ts` re-plans the book with `planFor` at Pay
time — `lib/photobook/build.ts:36` — and prices *that* result with `priceOf`,
line 104. The owner only ever saw the price `preview/route.ts` quoted, from a
plan made against whatever the trip looked like a debounce-cycle ago. Nothing
ties the two together: a trip that grew a day, or had photographs added to
one, between the last preview response and the Pay press is charged at the
new, larger figure with no chance to see it first — the same staleness window
B482 closes for photo count, left open for price.

Not a security hole and not usually large: the two requests are normally
seconds apart on one screen. It is still the owner's own money charged at a
number their own screen never showed them.

## Work

Not investigated further — this is a capture, not a design. Worth deciding
before building anything: whether the order form should carry the previewed
price and refuse (or re-confirm) when the freshly-planned one differs, or
whether re-planning at Pay is itself the bug and the order should build from
the exact plan the last preview produced instead of asking `planFor` again.
The second is the larger change — it means serializing a `Photobook` (or its
inputs) across the two requests rather than trusting `options` alone to
reproduce it.

## Acceptance

TODO — depends on the design decided above. At minimum: adding a day's worth
of photographs to a trip after previewing a book and before pressing Pay must
not silently charge more credits than the preview quoted.
