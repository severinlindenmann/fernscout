---
id: B610
title: model.mjs is still the helper's source of truth for the file shape
type: CHORE
priority: medium
complexity: medium
area: fernscout-helper, validate-content, content model
found: "2026-09-06T15:11:53Z"
started: "2026-09-06T18:44:11Z"
session: ac8af30e-815d-4843-a94d-cf061a70269c
claimed: "2026-09-06T18:44:11Z"
---

# B610 — model.mjs is still the helper's source of truth for the file shape

## Why

**Design: `docs/plans/W41-the-file-shape-is-published.md`.** Steps 4 and 5 of
its Order section. Depends on B608 and B609.

With the document published and the interpreter reading it, `model.mjs` is a
second copy of the same truth — the exact thing W41 exists to end. It is kept
during B609 only as a fallback, so that step changes nothing observable.

## Work

- Move rules across in batches. After each batch the three fixture journals
  must produce findings identical to before — that is the check, and it is
  cheap to run.
- Where a rule cannot move because it reads the disk, leave it: gallery files
  existing, media folders belonging to no day, filename dates against
  frontmatter, duplicate slugs, dates with no day. W41 lists these as the
  client's permanently.
- Delete `model.mjs` only when the fixtures produce identical output from the
  manifest alone.
- `AGENTS.md` describes `model.mjs` as "every option there is". Correct it,
  and correct the sentence about what these tools keep — the file shape is
  fetched now too.

Not doing: touching `publish.mjs` beyond the `without:`/`unrecorded:` mapping,
which W41 explains is all it needs from the document.

## Acceptance

- `model.mjs` is gone and `selftest.mjs` passes against a live instance.
- With the network down and no cache, the helper says plainly that it checked
  the file format alone — it does not report a clean run as a clean bill.
- `AGENTS.md` no longer describes a copied file shape.

---

## Decided before starting, 2026-09-06: what replaces the fallback

Deleting `model.mjs` removes the only thing the helper can validate against
when it cannot reach an instance. B609 and B644 made the client report that
case honestly — "no manifest at all, an instance older than B608" — but with
`model.mjs` gone that message would be attached to a run with **no rules at
all**, which is a tool that has stopped working rather than one being honest.

`AGENTS.md` promises a clone that works without `npm install`; a clone that
needs a live server before it can check anything is a smaller promise than the
one made.

**So: commit a generated snapshot, do not keep a hand-written copy.**

- A `content-model.json` checked into the repository, produced by fetching a
  real instance's document, never edited by hand. It is not a second source of
  truth — it is a photograph of the one source, and the distinction is what
  keeps W41 intact.
- It carries the instance it came from and the date it was taken, and the
  helper says both whenever it falls back to it: *"the file shape from a
  snapshot taken from https://fernscout.ch on 2026-09-06 — the instance was
  not reachable, so this may be out of date."* A snapshot that cannot say it is
  a snapshot is exactly the copy this plan set out to delete.
- A small script refreshes it (`npm` is not available here, so a plain
  `node .claude/skills/shared/snapshot.mjs` or similar), and `selftest.mjs`
  fails when the snapshot disagrees with the live document — which turns going
  stale from something nobody notices into a failing check.

That last point is the whole reason this is acceptable. `model.mjs` rotted
because nothing compared it to anything. A snapshot that is diffed against the
instance on every self-test cannot rot silently.

Not doing: shipping a snapshot the tools prefer over the live document. The
instance always wins when it can be reached.
