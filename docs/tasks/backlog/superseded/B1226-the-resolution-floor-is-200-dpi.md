---
id: B1226
title: The resolution floor is 200 dpi where the printer starts warning at 225
type: FEATURE
priority: low
complexity: low
area: photobook, print
found: "2026-09-10T05:10:00Z"
superseded: "already built — photobook.warn.lowResolution says it plainly, and the owner chose to keep the 200 dpi floor"
---

# B1226 — The resolution floor is 200 dpi where the printer starts warning at 225

## Why

`HERO_FLOOR_DPI = 200` (lib/photobook/spec.ts:258) is the resolution below
which `containWithinResolution` stops enlarging a photograph. Gelato's prepress
warns about anything **between 150 and 225 ppi**, so a photograph our planner
is happy with at 210 dpi is one their preflight flags.

Measured on `severin/algarve-2026`, the first book to reach real prepress:

```
Warnings
  Resolution of color and grayscale images larger than 16x16 pixel
  is between 150 and 225 ppi inside BleedBox (1)
```

Exactly one photograph, and the planner already names it:

```
kajak-in-lagos/02.jpeg is 1476px wide but is printed 174mm wide,
  which needs 2056px — it will print at about 215 DPI
```

215 sits above our floor and inside their band. Every other photograph in the
book is 280 dpi or better, so this is the floor's edge and not a systemic
problem — B1172 already fixed the systemic one.

## Decided: it already says it

The owner chose "say it in the composer, and do not mention the printer". That
is what `photobook.warn.lowResolution` already does, in the reader's own
words:

> These {count} photographs have too few pixels for this size and will look
> slightly blurred on paper — perfectly visible, just not crisp. Pick a smaller
> book, swap in bigger versions, or leave it as it is.

B701 shows the offending photographs beside it. No printer is named, which is
right: the person is choosing a photograph, not reading a preflight report.

The floor stays at 200. The warning below stands as a warning.

## The decision this needed

Raising the floor to 225 would draw that photograph about 4% smaller and the
warning would not appear. That is a layout change to every book for a
prepress warning on a few — it is a judgement about which matters more, not a
bug, and the owner should make it.

Three ways to go:

- **Raise the floor to 225.** Aligns us with the printer, costs a few percent
  of size on the weakest photographs.
- **Leave it at 200 and let the warning stand.** A warning is not a refusal,
  and 215 dpi prints perfectly acceptably at this size.
- **Say it in the composer instead.** The page already shows low-resolution
  warnings with the photograph (B701); it could say "your printer will flag
  this" rather than silently choosing for them.

## Not in scope

Upscaling. A 1476px photograph does not become a 2056px one, and pretending
otherwise is what `withoutEnlargement` in `lib/photobook/images.ts` exists to
prevent.
