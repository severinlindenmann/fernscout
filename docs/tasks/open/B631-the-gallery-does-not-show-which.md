---
id: B631
title: The gallery does not show which photographs are held back
type: FEATURE
priority: medium
complexity: low
area: gallery, photo visibility
found: "2026-09-06T17:51:44Z"
---

# B631 — The gallery does not show which photographs are held back

## Why

B596 gave a gallery item its own `visibility:` — `guest` or `private`, always
narrowing — and it works: `visible()` strips the item and the media route
refuses the file. What is missing is the owner's own view. Looking at a gallery
as the owner, every photograph looks alike, so there is no way to check that
the one picture meant to be held back actually is. A visibility feature nobody
can see the state of is a feature nobody trusts.

## Work

- To a reader who is the owner or on the trip, mark a photograph that carries a
  `visibility:` — small, unobtrusive, and only where the label exists.
- Nothing changes for anyone else: an ordinary reader sees no marker, because
  they see no held-back photograph at all.
- Add held-back photographs to the example journal so this can be looked at —
  a few pictures on `/example`, some `guest`, some `private`. That is also what
  demonstrates B596 to somebody reading the demo.

## Acceptance

- As the owner, a `guest` and a `private` photograph on `/example` are visibly
  distinguishable from an unlabelled one.
- Signed out, `/example` shows neither the markers nor the photographs.
