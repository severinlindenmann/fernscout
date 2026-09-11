---
id: B1228
title: Only one of the six size-and-cover combinations has ever reached a printer
type: CHORE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-10T05:32:00Z"
started: "2026-09-10T05:08:48Z"
merged: "2026-09-10T05:30:20Z"
---

# B1228 — Only one of the six size-and-cover combinations has ever reached a printer

## Why

Everything learned in the last day — photographs at print resolution (B1172),
the two blank leaves Gelato counts (B1173), one PDF with the cover as page 1
(B1205), the leaves before the colophon (B1206), the CLI fetching the real
cover geometry — was measured against exactly one product: **softcover
200 × 200**.

The code is generic and should carry to the rest, but "should" has been wrong
about this printer at every step. The other five have never been built since
any of it landed, and the hardcover ones differ in the way most likely to
break: a hardcover sheet wraps boards and has a joint either side of the
spine, so its cover geometry is a different shape and comes from a table
Gelato maintains rather than a formula.

The six, from `lib/photobook/spec.ts`:

| Size | Soft | Hard |
| --- | --- | --- |
| pocket 140 × 140 | yes | — |
| square 200 × 200 | yes | yes |
| portrait 210 × 280 | yes | yes |
| large-square 280 × 280 | — | yes |

## Work

- Build the same trip in every combination.
- Check each: total pages = declared + 3, page 1 the cover at Gelato's own
  `cover-dimensions` for that product and page count, the rest at the trimmed
  page, and the file tens of megabytes rather than hundreds.
- Send one example per combination to the owner so a person can put them
  through Gelato's uploader by hand.

## Acceptance

- Six books, six mails, each carrying one PDF the owner can upload.
- Every one passes the checks above.

## Evidence

Built from `severin/algarve-2026` on the live instance, every combination
checked against Gelato's own `cover-dimensions` for that product and page
count:

```
pocket soft         42pp  pages 45/45  cover 289.81x146 (want 289.81x146)  trim 146x146  34.5 MB
square soft         42pp  pages 45/45  cover 409.81x206 (want 409.81x206)  trim 206x206  61.5 MB
portrait soft       42pp  pages 45/45  cover 429.81x286 (want 429.81x286)  trim 216x286  89.1 MB
square hard         42pp  pages 45/45  cover 458x246    (want 458x246)     trim 206x206  61.5 MB
portrait hard       42pp  pages 45/45  cover 478x326    (want 478x326)     trim 216x286  89.1 MB
large-square hard   42pp  pages 45/45  cover 618x326    (want 618x326)     trim 286x286  98.3 MB
```

Every one: `pageCount + 3` pages, page 1 the cover sheet at Gelato's own
figure to the hundredth of a millimetre, the rest at the trimmed page plus
bleed. The hardcovers are the ones that mattered — their sheet wraps boards and
has a joint either side of the spine, and the figure comes from a table Gelato
maintains rather than a formula. All three agree.

Sizes are 34–98 MB where the first of these books was 356 MB (B1172).

**Six mails sent** to the owner, one per combination, each carrying the single
PDF — plus a seventh listing all six as *signed* links, because a receipt's
plain link needs a session and a mail client has none. One signed link was
fetched with no cookie at all: `HTTP 200, 103073316 bytes`.

Found and fixed on the way: **B1229** — `book.pdf` was written by the build,
linked from the receipt, and refused by the download route, whose `FILE_RE`
only ever matched the old interior/cover pair.
