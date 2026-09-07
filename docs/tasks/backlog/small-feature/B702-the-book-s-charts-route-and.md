---
id: B702
title: The book's charts, route and rules are drawn in a blue that is not a brand colour
type: FEATURE
priority: medium
complexity: low
area: photobook, brand
found: "2026-09-07T00:00:00Z"
---

# B702 — The book's charts, route and rules are drawn in a blue that is not a brand colour

## Why

`ACCENT` in `lib/photobook/charts.ts:49` is `#2b5c85`, a blue that appears
nowhere in `app/globals.css` and nowhere on the waymark. It is most of the
colour in a printed book: the six budget tints, the route line and its stops,
every rule under a heading, the day's location line, and the eyebrow on the
cover. The owner looking at their own book asked for it not to be blue.

Two more things sit alongside it and are the same fault:

- **The palette is claimed to have one copy and has two.** The comment above
  `PALETTE` says `preview.ts` turns these into CSS with `cssTone` so there is
  never a second ink table — and `preview.ts:609` then hardcodes
  `--accent:#2c5c85`, a *different* blue from the one it is drawing beside.
  The composer has been showing a page in a colour the press was never asked
  for, which is the exact thing that comment forbids.
- **Nothing sets `accent-color`**, so every checkbox and radio on the site is
  the operating system's blue — including the six in the book's own settings
  panel, which is what the owner was looking at when they said this.

## Work

- `ACCENT` becomes the waymark's ochre. **Two weights, one hue**, because one
  constant cannot do both jobs: the accent also carries small type
  (`render.ts:618`, `:817`) and a bright `#d69b0a` is about 3:1 on white, which
  is not readable at caption size. So a deep ochre for ink and rules, and the
  bright one as the base of the six chart tints.
- `PALETTE.faint`, the wash behind a table row, is a blue-grey; make it warm so
  it belongs to the same book.
- `preview.ts` derives its CSS accent from `cssTone("accent")` instead of
  keeping its own hex.
- One `accent-color` on `:root` in `app/globals.css`, site-wide.
- Not doing: a palette the owner can choose. One book, one ink.

## Acceptance

- No hex in `lib/photobook/` or `preview.ts` is a blue.
- `preview.ts` has no accent hex of its own; changing `ACCENT` changes the
  composer and the PDF together.
- A checkbox anywhere on the site is not OS blue.
- Looked at: `/docs/branding/print` and a rendered book, per `check-a-drawing`.
