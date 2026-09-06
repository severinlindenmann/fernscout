---
id: B610
title: model.mjs is still the helper's source of truth for the file shape
type: CHORE
priority: medium
complexity: medium
area: fernscout-helper, validate-content, content model
found: "2026-09-06T15:11:53Z"
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
