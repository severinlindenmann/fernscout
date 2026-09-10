---
id: B1017
title: Photobook fonts are embedded whole, not subset
type: CHORE
priority: low
complexity: medium
area: photobook, print
found: "2026-09-08T19:17:39Z"
wontDo: Font subsetting is font-table engineering for a storage win, at the cost of a bug class only visible in print.
---

# B1017 — Photobook fonts are embedded whole, not subset

## Why

B1008 embedded the three print faces (`lib/print-fonts/LiberationSans-*.ttf`)
into every photobook interior and cover as real `FontFile2` streams, which is
what `pdffonts` needed to see to report `emb: yes` — the acceptance line that
mattered. It does not subset them: each face goes in whole, about 400 KB
apiece (`lib/postcard/pdf.ts:504-524`), regardless of how few glyphs the book
actually uses. Three faces on both the interior and the cover PDF is roughly
1.2 MB of pure font data on every order, most of it glyphs — Cyrillic,
Thai, ligatures no layout here produces — that never appear on the page.

For a 20-page pocket book this is noise. For a large multi-volume trip it is a
measurable fraction of the file a provider has to fetch and a self-hoster has
to store (see B483's retention policy in `docs/providers/photobook.md`), and
it is the honest remainder of "fonts are not embedded": embedded, not minimal.

## Work

Write a TrueType subsetter for the three faces: given the actual codepoints a
book uses (WinAnsi range only — `lib/photobook/text.ts` already builds
`/Widths` off that assumption), keep only the referenced glyphs plus `.notdef`,
rebuild `loca`/`glyf`/`hmtx`/`cmap` and the other tables a viewer needs, and
write a smaller `FontFile2`. Ghostscript would do this in one pass
(`-dSubsetFonts=true`) but is a deploy-time dependency this repository has
deliberately not added (see `docs/providers/photobook.md`,
"CMYK conversion remains available"); this ticket is for the self-contained
alternative, in the same hand-rolled-writer spirit as `lib/postcard/truetype.ts`.

**Not in scope:** re-adding Ghostscript as a dependency — that was considered
and declined for B1008. If a subsetter turns out to need more machinery than
this codebase wants to carry, that is a finding for this ticket to report, not
a reason to reach for `gs` instead.

## Acceptance

- `pdffonts` on a generated interior and cover still reports every font
  `emb: yes`, now with `sub: yes`.
- The three embedded `FontFile2` streams are each smaller than the source
  `.ttf` file for a book whose text does not use the whole Latin range (which
  is every book: no layout here emits non-Latin glyphs).
- `npx vitest run test/postcard.test.ts test/photobook.test.ts` still passes —
  glyph widths and layout must not move.
