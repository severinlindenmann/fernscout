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

## The 18 that existed, 2026-09-15 — deleted, and their masters restored

Done at the owner's request, through the instance's own doors; the defect
itself is still open and is what this ticket is for.

1. **The 18 orphans were deleted** — `DELETE /api/v2/severin/media`, 18 × 200.
   Manifest 4994 → 4940 files, storage 3945.5 → 3901.5 MB, both days still
   published and still naming 15 and 10 photographs.
2. **That cost the print masters, and it was not foreseen.** The orphan was the
   copy holding the *true camera original*; the kept copy's original is the
   re-derived file the second upload sent. `deleteMediaV2` removes the original
   with the photograph, so 18 masters went from ~2–3.6 MB each to ~300 kB —
   5.9 MB where there had been 38.1 MB. Nothing was lost overall: the camera
   originals were still in the folder under `originals/`.
3. **Repaired**: each true original was uploaded again (stored under its own
   hash — the name the orphan had), each day was patched back to its own order
   and count pointing at the restored copy, and the 18 re-derived copies were
   deleted. The site now holds 15 photographs with 29.2 MB of masters on one
   day and 10 with 24.3 MB on the other; the smallest restored master is
   1,088,281 bytes, and no re-derived master is left.
4. **The folder is a mirror again**: `sync down`, then both legs saying `4940
   files on the site, 4940 here`, `push 0`, `pull 0`. Getting there turned up
   one more defect in the sync, fixed and recorded as **B1793**.

What this ticket still wants is the rule that stops it happening: nothing
anywhere asks whether the instance already holds this photograph before storing
another copy of it.
