---
id: B501
title: The demo journal keeps no originals, so every demo book prints soft
type: CHORE
priority: medium
complexity: low
area: demo content, photobook
found: "2026-09-05T17:05:25Z"
---

# B501 — The demo journal keeps no originals, so every demo book prints soft

## Why

`scripts/build-demo-content.mjs:1209` fetches each demo photograph once, at
web size — `SHAPES` tops out at 1600px and one shape is 1067px. There is no
`originals/` directory anywhere under `content/example/`.

So every book built from the demo journal falls back to the web copy and warns
about all of it. A `no-original` line naming all 18 photographs, then one
`low-resolution` line each: 1067px across a 290mm page is **93 DPI**, which is
about newspaper. The warnings are correct and the book really would be soft.

It matters more than a demo usually would, because `content/example/` is the
thing a fresh clone opens and the thing an agent reads to learn the content
model. A journal that cannot produce a printable book teaches that the print
path does not work, when in fact only its pixels are missing.

Confirmed while looking at B496: Lorem Picsum serves the **same photograph**
for a given seed at any size — `seed/<s>/1600/1067` and `seed/<s>/4000/2667`
are the same picture — so the originals can be fetched without changing which
photographs the demo shows.

## Work

Fetch a second copy of each photograph into
`content/example/trips/<trip>/originals/<day>/NN.jpg`, same seed, 4000px on the
long edge. A full-bleed 324mm page needs 3826px, so 4000 clears it with a
little room; going higher only costs download time.

`printSourceFor` and `bookFile` already prefer an original where one exists —
nothing in `lib/photobook/` needs changing.

The repository does not get heavier: `content/*/trips/*/originals/` is
gitignored (`.gitignore:79`). The cost is one more download per photograph on
`npm run demo:build --media`, which is already opt-in — roughly 1.3 MB each.

**Not doing:** re-running the demo builder on the VPS. It regenerates the whole
demo journal, and that content has had a real photobook ordered against it.
Copy the `originals/` directories up instead.

## Acceptance

- `npm run photobook -- --trip example/asia-2023` reports no `no-original` and
  no `low-resolution` warnings.
- `npm run demo:build` with no `--media` still works offline.
- The repository's tracked size is unchanged.
