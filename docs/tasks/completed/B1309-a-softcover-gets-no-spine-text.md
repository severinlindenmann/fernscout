---
id: B1309
title: A softcover gets no spine text even where the spine is wide enough for one
type: ISSUE
priority: medium
complexity: low
area: photobook, print
found: "2026-09-10T06:00:00Z"
merged: "2026-09-10T06:20:00Z"
---

# B1309 — A softcover gets no spine text even where the spine is wide enough for one

## Why

`renderCover` drew the spine title only `if (spineW >= 6)`. A 42-page
200 × 200 softcover has a **3.81 mm** spine, so every soft book came out with a
bare spine while the hardcovers were lettered — which is exactly what the owner
found testing the six examples: *"square Softcover, 20x20 — there is no
buchanschrift but there it possible for one, same for the other softcover."*

Six millimetres was never the real threshold, only a safe one. The comment
beside it gives the actual reason: perfect binding wanders, so type set to the
full width of the spine ends up on the front cover. That is a statement about
**tolerance**, not about six millimetres.

Worse, the order panel promises the title either way — *"Auf dem Buchrücken
steht «Algarve 2026 · 2026»"* — so on every softcover it said something the
file did not do.

## Work

- Ask whether the type fits between the binding's tolerances instead of
  comparing the spine to a constant: keep 0.8 mm clear either side and set the
  title to whatever fits in what is left, never larger than the caption size it
  would have had.
- Below 5 pt there is nothing worth printing, and no title is the better
  answer.

## Acceptance

- A 42-page 200 × 200 softcover carries its title on the spine.
- A 28-page one still does not — 2.41 mm has no room.
- Hardcovers are unchanged.
- `npm run verify`.

## Measured

```
42pp soft 200x200   spine 3.81 mm -> 6.8 pt
28pp soft 200x200   spine 2.41 mm -> none
100pp soft          spine 8.00 mm -> 7.0 pt  (caption size, unchanged)
42pp hard 200x200   spine 6.00 mm -> 7.0 pt  (unchanged)
```

## Still open

The order panel claims a spine title for books that will not get one — a
28-page softcover still reads "Auf dem Buchrücken steht …". The panel would
need the spine width, which it does not have before the build. Captured
separately rather than half-plumbed.
