---
id: B849
title: The traveller figures never appear on a postcard: cqh does not resolve against an inline-size container
type: ISSUE
priority: high
complexity: low
area: postcards
found: "2026-09-07T16:51:56Z"
---

# B849 — The traveller figures never appear on a postcard: cqh does not resolve against an inline-size container

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`travellersSvg` (lib/photobook/travellers.ts:116) sizes itself with
`style="height:${heightPct}cqh"`. B740 changed that from `%` to `cqh`
deliberately, and the comment there explains why it works: the photobook
preview's `.sheet` is `container-type: size`, so `cqh` is a percentage of the
printed page whatever the boxes in between are doing.

The postcard back reuses the same function —
`app/[user]/postcards/[id]/page.tsx:245`, `travellersSvg(100, party)` — but its
card is `containerType: "inline-size"`
(`app/[user]/postcards/[id]/PostcardBack.tsx:153`). **An inline-size container
answers `cqi`/`cqw` and not `cqh`**, so the height falls back past it: to an
outer size container if one exists, and otherwise to the small viewport.
`100cqh` then means roughly the whole window, inside an absolutely-positioned
box 22 × 14 mm on a 148 × 105 mm card. The figures are drawn and are not
visible.

Observed on the live instance: an order with `figures: true` in its payload, on
a trip carrying two parsed `travellers:` entries, rendering a back with no
figures on it. The PDF is unaffected — `renderPostcard` draws them through
`drawTravellers`, which is tested (test/postcard.test.ts:509) and does not go
near CSS. So this is the preview lying about the paper, which is the one thing
the preview exists not to do.

This is B740 one component along: the same unit, the same invisibility, the
same reason nobody caught it — the PDF drew them all along.

## Work

The likely one-word fix is `container-type: size` on the postcard card rather
than `inline-size`. The card already has a fixed `aspectRatio`, so its height
does not depend on its contents and `size` is legal there; `cqw` keeps
resolving as it does now, which matters because the whole type scale in
`lib/postcard/preview.ts` is expressed in `cqw`.

**Check it, do not reason about it.** This is a drawing: follow
`check-a-drawing`, look at the back at print size and at 390px, and confirm the
figures land beside the signature and inside the trim rather than merely
appearing somewhere.

Consider whether `travellersSvg` should refuse to be sized in a unit its caller
cannot answer — a shared function whose sizing silently depends on a CSS
property three files away is the actual defect, and a second caller got it
wrong within a year of the first.

## Acceptance

- The back preview on `/(user)/postcards/(id)` shows the trip's party beside
  the signature, at the same place and proportion the PDF puts them.
- A screenshot at print size and one at 390px, both looked at.
- Whatever guards this in future is not a unit test asserting a CSS string:
  that is what passed while the figures were invisible.
