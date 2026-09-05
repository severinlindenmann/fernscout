---
id: B417
title: access-gate.test.ts still carries a digest column for a function B387 deleted
type: CHORE
priority: low
complexity: low
area: tests
found: "2026-09-05T08:31:28Z"
started: "2026-09-05T08:49:36Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T08:49:36Z"
---

# B417 — access-gate.test.ts still carries a digest column for a function B387 deleted

## Why

B387 removed the weekly digest: `lib/digest/index.ts`, `visibility.ts`,
`mail.ts` and `scripts/digest.mts` are all gone, confirmed absent from the
deployed tree at `/srv/fernscout` on 2026-09-05.

`test/access-gate.test.ts` still has a `digest` column in its expectation
table, with a comment saying it mirrors `digestableTrips`. Nothing imports
`digestableTrips` any more and no assertion in the file reads `.digest` off the
table, so it is data nobody checks, describing a function that does not exist.

Harmless today. It matters the next time somebody edits that table and reasons
about a column that has no meaning — the table is the readable record of who
may see what, and a dead column makes it lie about its own scope.

Found while verifying B52/B70/B184, all three of which B387 superseded.

## Work

Drop the column and its comment.

## Acceptance

`grep -c digest test/access-gate.test.ts` returns 0, and the suite still passes.
