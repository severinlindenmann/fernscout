---
id: B1478
title: The print bench shows one postcard and one book; it should show every format and what Gelato actually requires
type: DOCS
priority: medium
complexity: medium
area: Print / branding benches
found: "2026-09-11T15:44:03Z"
---

# B1478 — The print bench shows one postcard and one book; it should show every format and what Gelato actually requires

## Why

`/docs/branding/print` draws exactly two things: one postcard back at
`A6_LANDSCAPE`, and one photobook spread at `defaultSpec()`
(`components/branding/PrintBench.tsx:83,120`). Every other format this
software can actually order is invisible there — and a bench whose job is
"look at what we print, because no test can" is only doing that job for the
default.

What is missing is not decoration. `lib/photobook/spec.ts` has four book
sizes with different cover availability (`pocket` 140×140 soft only,
`square` 200×200 soft+hard, `portrait` 210×280 soft+hard, `large-square`
280×280 **hard only**) — so the one asymmetry a person most needs to see,
that a size grid changes when you pick a cover, is the one the bench never
shows. Hardcover geometry differs from soft in a way that cannot be reasoned
about from a softcover drawing: a wrap, a turn-in and a joint either side of
the spine (`lib/photobook/coverGeometry.ts`), and the spine width depends on
the page count.

The second half is the Gelato knowledge that has been learned the hard way
and currently lives only in code comments and `docs/providers/photobook.md`
(694 lines nobody opens before looking at a layout). A person standing at
the bench should be able to read, beside the drawing: pages are 28–200 and
must be **even** — `GELATO_PAGE_RULE`, read off the live API on 2026-09-07
and replacing a guessed `multipleOf: 4`; 3 mm bleed, 10 mm safe, 16 mm
gutter at the spine, 300 dpi target with a 200 dpi floor for a hero
(`HERO_FLOOR_DPI`); product uids are verbatim catalogue strings and a
missing entry means the product does not exist, not that we forgot it; and
what the PDF/X pipeline (`lib/photobook/pdfx.ts`) requires of a submitted
file.

## Work

- Extend `components/branding/PrintBench.tsx` to render **every** format from
  the constants, never a hand-typed list: iterate `BOOK_SIZES` × `COVER_TYPES`
  via `sizesFor()`, and every postcard size in `lib/postcard/spec.ts`.
- Show hardcover cover geometry as its own drawing — wrap, turn-in, joint,
  spine — from `coverGeometry.ts`, at a couple of page counts so the spine
  visibly changes.
- Put the facts beside the drawings, each rendered from the constant rather
  than retyped: page rule, bleed/safe/gutter/dpi, the hero dpi floor, the
  product uid (or "no such product" where a cover is absent).
- Verify each stated Gelato fact against `lib/photobook/*.ts` and
  `docs/providers/photobook.md` before writing it; correct whichever of the
  two is wrong rather than adding a third copy. Anything that turns out to be
  unverified belief goes in as an open question, not as a figure.
- Not doing: a quote, a price, or anything that calls Gelato. The bench needs
  no key, no journal and no capability, and that is why it is the fastest page
  here to open — keep it that way.

## Acceptance

- `/docs/branding/print` shows all four book sizes, both covers where the
  catalogue has them, `large-square` visibly hard-only, and every postcard
  size.
- Adding a size to `BOOK_SIZES` makes it appear on the bench with no edit to
  the bench.
- Every number on the page traces to a constant; grepping the bench for a
  literal millimetre value finds none.
- Looked at in a browser at 390 px as well as wide (`check-a-drawing`).
