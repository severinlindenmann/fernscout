---
id: B1173
title: Gelato demands a page count two higher than the one it accepted a quote for
type: ISSUE
priority: high
complexity: low
area: photobook, gelato
found: "2026-09-09T22:22:00Z"
started: "2026-09-09T20:39:40Z"
session: ce87fdc2-3f66-428c-90d3-ae9d8df84e40
claimed: "2026-09-09T20:39:40Z"
---

# B1173 — Gelato demands a page count two higher than the one it accepted a quote for

## Why

Order `b17146b4-…` was refused with:

> Product requires exactly 49 page(s), while file(s) contain 47 page(s)

What was actually sent, confirmed by reading the order back from
`GET /v4/orders/c60a17c1-…`:

```
pageCount sent      46
interior file       46 pages   (/Count 46, 46 page objects)
cover file           1 page
their count         47         = 46 + 1, so they count both files
their requirement   49         = 2 more than we sent
```

Everything upstream accepted 46:

- `validPageCounts` for this exact productUid lists every even number from 28
  to 200 — **46 is in it**.
- `orders:quote` priced 46 without complaint, which is what the owner paid for.

And Gelato's own downloaded template for the same product at 30 pages
(`docs/providers/gelato-templates/softcover-200x200-30pp.pdf`) contains **31**
pages — 30 interior plus 1 cover, exactly the shape we send. By that ratio a
46-page book should need 47, which is what we sent.

So the requirement is two higher than every other part of Gelato's own API
says it should be, and this ticket cannot be closed by reasoning — it needs
their answer or a measurement.

**Leading hypothesis, not a conclusion:** `bt_glued-left` (perfect binding) may
require the interior to be a multiple of **four** in prepress even though
`validPageCounts` lists all evens — 46 rounds to 48, plus the cover is 49. It
fits both numbers, and nothing else tried does.

**Why no test caught it:** prepress does not run on `orderType: "draft"`, and
every order before this one was a draft. Drafts validate the product and the
address, never the files.

## Work

- Ask Gelato which it is, or measure it: place one real order at a page count
  that is a multiple of four and see whether the same book validates.
- If the hypothesis holds, choose interior page counts that are multiples of
  four in `expandToMinimum` for glued-left bindings. That is safe either way —
  every multiple of four is also in `validPageCounts` — and costs at most two
  padded pages.
- Whatever the answer, the file count and the declared `pageCount` should be
  asserted equal before submitting, so a mismatch is our own error rather than
  the printer's.

## Blocked on

A real order, which needs a payment method on the Gelato account. Drafts
cannot reproduce this.

## Note

Very likely entangled with B1172 — the interior their prepress could not render
is the same file it counted. Fix that first and re-measure before acting on the
hypothesis here.
