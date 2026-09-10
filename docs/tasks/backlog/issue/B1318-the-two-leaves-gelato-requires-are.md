---
id: B1318
title: The two leaves Gelato requires are blank, so prepress calls them a fault
type: ISSUE
priority: medium
complexity: low
area: photobook, print
found: "2026-09-10T15:45:00Z"
---

# B1318 — The two leaves Gelato requires are blank, so prepress calls them a fault

## Why

Uploading a 42-page book with 42 declared passes — no critical errors — and
warns:

```
At least one page is empty (2)
Pages affected: 43 44
```

Those two are the leaves B1173 added because Gelato refuses any file that is
not `pageCount + 3` pages. The owner's question was the obvious one: *"can we
not remove those two blanks?"*

**No.** The count is not ours to choose. Declare 42 and the file must be 45;
declare 40 and it must be 43 — either way the interior carries two pages more
than the book has. Measured three times against the live API (B1173), and
their own template has them too: 31 pages for the 28-page product.

But nothing says they have to be *white*. They were left blank because they
were thought of as filler, and prepress is right that a white page nobody
chose looks like a mistake.

## Work

Give them the warm wash `PALETTE.faint` — the tone the charts already use
behind a row — across the full bleed. A tinted leaf at the back of a book is
an endpaper; a white one is an accident. Full bleed rather than to the trim,
because a tint that stops short shows a white edge wherever the guillotine
lands.

## Acceptance

- The two leaves carry the tint, and Gelato's "at least one page is empty" no
  longer names them.
- The page count is unchanged — this changes what is on them, never how many.
- `npm run verify`.

## Measured

The rendered leaf reads RGB `249 241 221`, which is `PALETTE.faint`
(`0.976, 0.945, 0.867`) exactly.

## Not fixed here

The other warning — a few photographs between 150 and 225 ppi — is the
owner's own originals being too small, and B1226 records the decision to leave
the floor at 200 dpi and say so in the composer.
