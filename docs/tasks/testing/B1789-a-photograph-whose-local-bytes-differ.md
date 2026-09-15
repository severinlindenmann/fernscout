---
id: B1789
title: A photograph whose local bytes differ from the site's derivative is planned, never sent, and reported as a push that did not land, on every run
type: ISSUE
priority: medium
complexity: medium
area: fernscout-helper sync / media
found: "2026-09-15T08:53:53Z"
started: "2026-09-15T08:57:36Z"
merged: "2026-09-15T09:01:30Z"
---

# B1789 — A photograph whose local bytes differ from the site's derivative is planned, never sent, and reported as a push that did not land, on every run

## Why

Found while verifying B1787 against fernscout.ch/severin on 2026-09-15. After
that fix the whole journal agrees — 4994 files, `up` plans nothing and `down`
pulls nothing — except one photograph, and it is stuck in exactly the loop
B1787 described, by a different route:

```
  plan: push 1 (1.6 MB), unchanged 4975, site-only 0
    ↑ trips/budapest-2023/media/2023-07-08-morgen-in-salzburg/b12e927b9c59c9acd7d2fdd0c2059198.jpg  — changed locally
  …
✗ 1 file was planned for the site and did not appear to have landed:
```

Measured, both sides, same path:

- the site's copy is **241,196 bytes**, the folder's is **1,698,313** — the
  instance serves its own derivative, and the folder holds something larger
  under the same hash-named path;
- the day already names that `src`, so `pendingMedia()` in `publish.mjs` reads
  it as attached and uploads nothing;
- the folder's copy **is** the original: its own SHA-256 is
  `b12e927b9c59c9acd7d2fdd0c2059198`, which is the name it sits under. The
  site holds that same original at
  `trips/budapest-2023/originals/2023-07-08-morgen-in-salzburg/b12e…jpg`,
  1,698,313 bytes, and the folder has that copy too — so the `media/` path
  locally is a pre-upload staging copy nothing replaced;
- so the push is planned, nothing is sent, `landed()` sees a remote hash that
  did not move, the path is never recorded as agreed, and the run exits
  non-zero. The next run plans the same file again. It never settles.

**96 media files on that journal differ from the site's copy**, not one. The
rest are hidden the same way B1787's were: the baseline remembers both sides,
so nothing is planned and nothing looks wrong, and the folder is quietly not a
mirror.

B1787's rule does not reach it and should not: that one is about two documents
saying one thing, and there is nothing to normalise about two different JPEGs.

## Work

The site's derivative is authoritative: it is the instance's own work, nothing
on the client can produce it, and there is no door to send one. So a `media/`
file both sides hold and spell differently is pulled down, not pushed — the
folder is a mirror of what the site serves. The local copy is not lost: it is
the original, and the original is on the site under `trips/<trip>/originals/`,
which has been in the sync since B1719.

`originals/` is left alone. A master is derived from nothing, so two sides
differing there is a real difference somebody should look at rather than have
overwritten quietly.

## Acceptance

`sync up` against a journal holding a derivative whose bytes differ from the
site's plans it once, resolves it, and exits zero; the next run has nothing to
say about it.

## Built, 2026-09-15 — fernscout-helper `addd970`

**Valid when taken, and larger than the one file that found it: 96.** The rest
were hidden exactly as B1787's were — the baseline remembers both sides, so
nothing is planned and nothing looks wrong, while the folder is quietly not a
mirror.

Measured before touching anything, all 96:

- the local copy under `media/` **is the original** — its own SHA-256 equals
  the name it sits under, in all 96 cases;
- the same bytes are on the site under `trips/<trip>/originals/<day>/`, in all
  96 cases;
- and that master was already in the folder too, in all 96 cases.

So taking the site's derivative loses nothing, and that is what it does now, in
the same pass B1787 added: `servedDerivative()` (`shared/syncManifest.mjs`)
names `trips/<trip>/media/<day>/<file>` — not the `.meta.json` sidecar beside
it, which is a document and is compared as one, and not `originals/`.

## Verified, fernscout.ch/severin, 2026-09-15

- **Before**: `plan: push 1`, the photograph named `— changed locally`,
  publish sends nothing, and the run ends `✗ 1 file was planned for the site
  and did not appear to have landed`. Every run.
- **The run itself**: `plan: push 0`, 96 photographs taken, `Nothing to send`,
  `Sync state written — 4994 files both sides agree on`. Nothing was written to
  the site: with nothing to push, `publish` was not invoked at all.
- **After**: `sync up --dry-run` → `push 0`, `sync down --dry-run` → `pull 0,
  unchanged 4994, local-only 0`, twice, exit 0, no stalled report. The folder
  and the instance now agree on all 4994 files.
- The one remaining thing either leg says is the 18 photographs deleted in the
  folder and still on the site, which this script refuses to delete there by
  design — unpublishing is editorial.

Keeper: one check in `sync.test.mjs` — a served photograph is the site's own
work; a sidecar and a print master are not. The helper's full `selftest.mjs`
is green.
