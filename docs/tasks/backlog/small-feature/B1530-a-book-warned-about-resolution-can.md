---
id: B1530
title: A book warned about resolution can only be made smaller, never given the bigger photograph
type: FEATURE
priority: medium
complexity: medium
area: media
found: "2026-09-11T20:25:10Z"
---

# B1530 — A book warned about resolution can only be made smaller, never given the bigger photograph

## Why

The print paths already prefer the kept original over the 2000px web copy
(B13 for the book, B1010 for the card). On the live journal that preference
buys nothing, because **every original is already 2000px or smaller**:

```
58 × 1500x2000   3 × 1920x1080   1 × 900x2000   1 × 2000x900   1 × 2000x1500
```

— every kept original under `severin/trips/algarve-2026/originals/`, measured
2026-09-11. The `media/` derivative beside one of them is the same 1500×2000
and within a kilobyte of the same size.

2000px on the long edge is about **330 dpi on a 148mm postcard** — fine — and
about **254 dpi on a 200mm book page**, which is why that book's composer is
showing "these 48 photographs have too few pixels for this size". The warning
is correct and the pipeline is behaving; the ceiling is the file that arrived.

**And there is no way to raise it.** The warning's only remedy is
`photobook.fix.smaller` — print the book smaller. An owner who still has the
full-size photographs on their phone cannot hand them over for a book they are
about to pay for: re-uploading to the day would add new photographs beside the
old ones rather than replacing what the print reads.

## Work

A way to replace the *print source* of photographs that are already on a day,
without touching the day's gallery, its order, or its captions: same slug, same
index, better bytes. Most likely a targeted upload that writes `originals/`
only and leaves `media/` alone — the derivative is already what readers should
get.

Then the warning offers it: beside "print it smaller", "send the originals".

Two things to decide and write down:

- **Matching.** Which photograph is which — by index and basename is the
  convention `findOriginal` already relies on, but a re-upload arrives with the
  camera's own name. A dHash comparison against the derivative
  (`lib/ingest/hash.ts` already computes one) is the honest match, and it
  should be shown for confirmation rather than assumed.
- **Storage.** `perUserBytes` counts the whole journal (B661). Replacing a
  2000px original with a 12MP one multiplies that trip's `originals/` several
  times over, and the owner should meet the number before it happens, not
  after.

Not doing: **raising `MAX_EDGE`**. The 2000px derivative is the file every
reader downloads on every gallery, and it is not what print reads — making it
4000 would roughly quadruple the page weight of a journal to fix a problem in
a different file. If print needs its own bigger copy for sources that cannot
be embedded, that is B1528.

## Acceptance

An owner with a warned book can supply the full-size photographs for the days
that triggered the warning, see which file matched which photograph before
anything is written, and watch the warning go quiet — with the gallery, the
captions and the day's order unchanged.
