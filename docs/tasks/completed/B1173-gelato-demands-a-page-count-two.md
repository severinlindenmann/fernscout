---
id: B1173
title: Gelato demands a page count two higher than the one it accepted a quote for
type: ISSUE
priority: high
complexity: low
area: photobook, gelato
found: "2026-09-09T22:22:00Z"
started: "2026-09-09T20:39:40Z"
merged: "2026-09-09T21:03:51Z"
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

## Answered, by measurement

Not blocked after all: a real order runs prepress **before** it checks the
card, so an account with no payment method is a free and unlimited test rig.
Three orders settled it.

```
sent 46  ->  counted 47 (46 + our 1 cover page), required 49
sent 42  ->  counted 43 (42 + our 1 cover page), required 45
sent 40  ->  same 43 pages, and prepress said nothing about the files
```

**Files must total `pageCount + 3`.** The third run is the one that proves it
rather than fitting it: the same bytes passed once the declared count was three
below their total.

The hypothesis in the Why — a multiple of four — was wrong, and Gelato's own
template said so all along. `docs/providers/gelato-templates/README.md` records
"each is 31 pages: one cover page, then thirty interior pages", checked against
a **28**-page book. 28 + 3 = 31. The reference had the answer in September and
nobody did the subtraction.

So: cover 1 page, interior `pageCount + 2`, and `pageCount` stays the number of
pages the book actually has — the number quoted, charged and declared.

**Confirmed end to end** on the live instance as reference `b1173-final`: 42
declared, 44 interior + 1 cover = 45, and the only message left on the order is
*"Please add payment details and try again."*

## Note

Very likely entangled with B1172 — the interior their prepress could not render
is the same file it counted. Fix that first and re-measure before acting on the
hypothesis here.
