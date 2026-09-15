---
id: B1789
title: A photograph whose local bytes differ from the site's derivative is planned, never sent, and reported as a push that did not land, on every run
type: ISSUE
priority: medium
complexity: medium
area: fernscout-helper sync / media
found: "2026-09-15T08:53:53Z"
---

# B1789 — A photograph whose local bytes differ from the site's derivative is planned, never sent, and reported as a push that did not land, on every run

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

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
- so the push is planned, nothing is sent, `landed()` sees a remote hash that
  did not move, the path is never recorded as agreed, and the run exits
  non-zero. The next run plans the same file again. It never settles.

B1787's rule does not reach it and should not: that one is about two documents
saying one thing, and there is nothing to normalise about two different JPEGs.

## Work

Decide what the folder's copy of a served derivative means, then make both legs
say it. Either the site's derivative is authoritative and a differing local
copy is pulled down (the folder is a mirror), or the local copy is a master
that does not belong at that path at all and belongs under `originals/`. What
must not stay is the third state: planned every run, sent never, reported as a
failure that no action can clear.

## Acceptance

`sync up` against a journal holding a derivative whose bytes differ from the
site's plans it once, resolves it, and exits zero; the next run has nothing to
say about it.
