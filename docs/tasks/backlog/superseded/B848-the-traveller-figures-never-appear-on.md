---
id: B848
title: The traveller figures never appear on a postcard: cqh does not resolve against an inline-size container
type: ISSUE
priority: high
complexity: low
area: postcards
superseded: "B849 — the same finding, filed twice in the same minute"
found: "2026-09-07T16:51:34Z"
---

# B848 — The traveller figures never appear on a postcard: cqh does not resolve against an inline-size container

## Why

The same finding as **B849**, filed twice: identical title, identical fault,
seconds apart. This copy was never written up — its Why, Work and Acceptance
were left as `TODO` — and B849 was taken, fixed and is in `testing/`.

The fault, for anybody arriving here: `travellersSvg` sizes itself
`height:<n>cqh`, and `cqh` is a *height* query unit that an `inline-size`
container cannot answer. It resolved past the card to the viewport, so the
figures came out about a window tall inside a box 22 × 14 mm on a 148 × 105
card — drawn every time, and never once visible. B740 is the same unit going
wrong in the photobook. The fix is in `app/[user]/postcards/[id]/PostcardBack.tsx`
and the comment there is the whole of it.

Nothing to do here. Read B849.
