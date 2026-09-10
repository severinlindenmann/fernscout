---
id: B1240
title: Every photo is answered instantly and separately instead of waiting for the batch
type: FEATURE
priority: medium
complexity: medium
area: whatsapp, helper, ux
found: "2026-09-10T08:48:06Z"
---

# B1240 — Every photo is answered instantly and separately instead of waiting for the batch

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Owner's live walkthrough, 2026-09-10: two photos sent seconds apart produced
two separate instant replies ("Angekommen — 1 warten…", "Angekommen — 2
warten…"). People send photo batches; a reply per photo is noise.

## Work

Hold the media reply per number for a few seconds (~5s, reset on each further
media message); then send one summary with the total count. In-memory timer
is fine (a deploy losing one pending summary is acceptable), but also flush
on the next non-media inbound so nothing is silently lost. The told-once tip
rides on the batch summary, not on each item.

## Acceptance

Three photos sent within the window produce one reply naming three; a single
photo still gets its reply after the window.
