---
id: B1408
title: "An en dash in a day's words comes out as a blank gap in the book"
type: ISSUE
priority: high
complexity: low
area: photobook, text rendering
found: "2026-09-10T22:18:00Z"
started: "2026-09-11T04:23:03Z"
merged: "2026-09-11T04:50:50Z"
---

# B1408 — An en dash in a day's words comes out as a blank gap in the book

## Why

Noticed on the same page as B1407, and it is the more serious of the two: the
book is printing somebody's own words with a character missing.

The day says:

> Roadtrip in den Naturpark an der Costa Vicentina. Windig, und am Abend kalt
> und windig **–** gegessen wurde trotzdem glücklich.

Checked in the file: the bytes are `e2 80 93`, U+2013 EN DASH. On the page
there is **no dash and a ragged blank space**, and the sentence breaks oddly
around it:

> … kalt und windig␣␣␣␣␣gegessen wurde trotzdem
> glücklich.

Words a person wrote are being altered in print, silently. An en dash carries a
pause; without it the sentence reads as a typing mistake that the person did
not make, in an object that costs credits and cannot be corrected once posted.

**Where to look, and one hypothesis worth testing first.** `lib/photobook/text.ts`
maps typographic punctuation to WinAnsi code points on purpose (`:38-79`) —
`["–", 0x96]` is there and the reasoning is right: folding an em dash to two
hyphens is how a printed page ends up looking like a text file. So the mapping
exists; something downstream of it does not carry the glyph.

Two candidates, and they are distinguishable in five minutes:

1. **The preview.** `toWinAnsi` returns a string containing a literal U+0096,
   which is an invisible C1 control character in HTML. If the preview renders
   that string in the browser, it shows nothing — which is precisely a blank
   gap. Check whether the screenshot's path is the HTML preview or the PDF; the
   WinAnsi mapping is for the PDF's simple fonts and may be being applied where
   it should not be.
2. **The embedded face.** If it is the PDF, check that the face in
   `lib/print-fonts` maps WinAnsi 0x96 to `endash`. The width path is a
   separate near-miss worth noting either way: `advance` (`text.ts:123-136`)
   has no `EXTRA` entry for 0x96, so it falls through to the width of `"n"` —
   which would also explain the spacing looking wrong rather than merely
   dash-less.

Whichever it is, the other punctuation in that table is in the same position:
curly quotes, the ellipsis, the bullet, the em dash. Test the whole row, not
only the one that was noticed.

## Work

- Reproduce first: build a book from a day containing `– — … ‘ ’ “ ” •` and
  look at the PDF and at the preview. Do not fix from the reading above.
- Fix wherever it actually breaks, and add the missing `EXTRA` widths for the
  0x80–0x9F marks while there, so the layout is computed with the widths the
  PDF declares — `metricWidths` and the `/Widths` array depend on that
  agreement, and `text.ts:139-145` says so.
- One check behind it: a string of that punctuation through the real text path,
  asserting the characters survive and the measured width is not the `"n"`
  fallback.
- Look at a real page afterwards (`check-a-drawing`), because a character that
  renders as a box instead of as nothing would pass a byte-level test and still
  be wrong in print.

**Not in this ticket.** No change to what punctuation the mapping covers, and
nothing that folds typographic marks to ASCII — that is the failure the table
was written to prevent.

## Acceptance

- The day above prints with its en dash, and the sentence spaces normally.
- Every mark in the `WIN_ANSI` table survives a round trip into a built PDF.
- The preview and the PDF agree, whichever of the two was at fault.
- `npm run verify` clean.
