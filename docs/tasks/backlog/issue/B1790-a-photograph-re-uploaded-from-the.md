---
id: B1790
title: A photograph re-uploaded from the site's own derivative is stored a second time, orphaning the first
type: ISSUE
priority: medium
complexity: medium
area: fernscout-helper publish / media
found: "2026-09-15T09:19:52Z"
---

# B1790 — A photograph re-uploaded from the site's own derivative is stored a second time, orphaning the first

## Why

Found while answering "what are those 18?" after B1789, on fernscout.ch/severin,
2026-09-15. They are not corrupt and nothing was lost: they are **first copies
of photographs that were uploaded a second time**, left on the site with no day
naming them. 18 of them, **44.0 MB** with their sidecars and originals.

The day `bodensee-2025/2025-06-20-rund-um-regatta` records it exactly, in the
sidecars the instance writes beside each stored photograph:

```
  05:46:28  orphan  uploaded from 01.jpg
  …         orphan  uploaded from 15.jpg          (12 of them)
  06:41:21  NAMED   uploaded from 91ec8a4f8c8ace5f06f0620f540967f5.jpg
  06:41:26  NAMED   uploaded from 04.jpg
  06:41:30  NAMED   uploaded from 1813e517c2ac7120b2530663994f4402.jpg
  …
```

The first run uploaded `01.jpg … 15.jpg`; the instance stored each under the
hash of its bytes and `adoptStoredName()` renamed the local file to match. The
second run, 55 minutes later, uploaded **twelve of those hash-named files
again** — `1813e517….jpg` went up as if it were a new photograph, came back
re-derived as `b830363d….jpg` (same image, 2000×1500, 332,481 bytes against
333,121), and the day was re-pointed at the new one. The first copy stayed on
disk, named by nothing.

A photograph is identified by the hash of the bytes that are sent, and a
re-derived JPEG does not have the same bytes as what produced it — so "the same
photograph" and "the same file" came apart, and `pendingMedia()`
(`publish.mjs:167`, exact `src` string comparison against the remote day) had
nothing to catch it with. Six more on
`mallorca-schweden-2021/2021-07-16-die-letzte-sonne-am-playa-de-palma`, the
same way.

B1789 removes one trigger — the folder now holds what the site serves rather
than a staged original under the same name — but not the rule that let it
happen: nothing anywhere asks whether the instance already holds this
photograph before storing another copy of it.

## Work

Make an upload able to recognise a photograph the instance already holds. The
instance writes `<stored>.jpg.meta.json` beside every photograph, recording the
filename it arrived as — so a file named for a hash the instance itself
assigned is knowable, from either side, without inventing anything. Decide
whether the client refuses to re-send it or the instance answers "I have this
already" with the existing `src`; the second is the better place, because it
holds for every caller rather than this one.

Deleting the 18 that exist today is the owner's call and a separate act — they
are on a published day's trip, and nothing on the site points at them.

## Acceptance

Publishing a folder twice, where the first run renamed the local files to the
names the instance assigned, leaves the day naming exactly the photographs it
named after the first run, and stores nothing a second time. A count of files
under `trips/<trip>/media/<day>/` matches the number of photographs the day
names.
