---
id: B872
title: Any photograph with no left-to-right contrast is silently dropped as a duplicate
type: ISSUE
priority: high
complexity: low
area: media, ingest
found: "2026-09-07T17:37:27Z"
started: "2026-09-07T17:41:39Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-07T17:41:39Z"
---

# B872 — Any photograph with no left-to-right contrast is silently dropped as a duplicate

## Why

`dHash` in `lib/ingest/hash.ts:29` records, for each pixel, only whether it is
brighter than the pixel **to its right**. A picture with no left-to-right
variation therefore hashes to all zeros — and every such picture is identical
to every other by Hamming distance.

Reproduced against the live instance on 2026-09-07:

```
plain.png       0000000000000000   (a plain grey rectangle)
got-02.jpg      0000000000000000   (a vertical blue-to-green sky gradient)
scene.jpg       0001080848483000   (a picture with something in it)
```

Distance 0, well inside `DUPLICATE_THRESHOLD = 3`, so the second upload was
**refused as already present and silently dropped**. Two completely different
pictures.

This is not a hypothetical class: a plain sky, fog, a whiteout, a wall, a
close-up of water, a photograph taken into the sun, a horizon-only shot — every
one is smooth left to right, and every one collides with every other on the
same day.

The file predicted it. `DUPLICATE_THRESHOLD`'s own comment says the cost is
asymmetric: *"a missed duplicate is a second copy in the gallery that you delete
in ten seconds, while a false positive silently drops a photograph you will
never know was there."* That is now happening.

Found by the caption audit, which noticed a test picture had vanished before it
could be described.

## Confirmed at scale, and broken both ways

A second tester, uploading 99 files to one day on the live instance, found the
same fault independently and larger:

- **38 of 38** low-detail photographs were silently discarded — 35 solid-colour
  test images with distinct SHA-256s, plus three realistic 1600×1200 travel
  photographs named `sky_over_mtskheta.jpg`, `fog_on_the_pass.jpg` and
  `snow_at_kazbegi.jpg`. All three matched **one unrelated existing file** and
  none was stored.
- **And the opposite failure**: one group of byte-identical PNGs was not caught
  at all — four uploads, four gallery entries.

So the mechanism wrongly merges distinct photographs *and* wrongly keeps
identical ones. It is not trustworthy in either direction.

The response for every discarded file was `201 ok:true` with **"already had
this one — nothing was lost"**. That sentence is false, and it is the part a
person or an agent reads.

Everything else in that run was sound: the 40-item cap refused cleanly and said
what to do, an oversized file and an empty file were both refused before
decoding, and a killed upload left nothing behind and resent safely.

## Work

The cheap fix the auditor proposes is the right shape: treat an all-zero or
near-zero-popcount hash as **unhashable** and let the file through unchecked —
which is already what the code does for an image `perceptualHash` throws on.
A picture with no horizontal signal carries no evidence either way, and the
asymmetry says which way to fail.

Consider also comparing against a vertical dHash, which costs six more lines
and would catch the gradients properly rather than excusing them.

While there: the response says `skipped` with a `matched` src, and the wizard
does not show it. A dropped photograph should be visible even when the drop is
correct.

## Acceptance

Two different flat pictures on one day both arrive. A genuine duplicate is
still refused, and a person can see what was skipped and why.
