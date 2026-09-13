---
id: B1678
title: lib/trips.ts.new is a committed editor scratch file
type: CHORE
priority: low
complexity: low
area: chore
found: "2026-09-13T14:28:33Z"
---

# B1678 — lib/trips.ts.new is a committed editor scratch file

## Why

`lib/trips.ts.new` (891 lines) sits beside `lib/trips.ts` (895 lines). It was
committed in `326396e8` ("B1598: the readers, writers and content move to
JSON") — an accidental `git add` of an editor scratch file during the
migration commit.

Nothing imports it: `grep -rn "trips.ts.new"` outside the file itself returns
nothing. `npm run unused` does not catch it because knip scans `.ts`, not
`.ts.new`, so it is invisible to the mechanical check.

It is an earlier draft — its warning strings still say `trip.md` — so a reader
who opens it learns something false about the current format.

## Work

Delete it.

## Acceptance

- `ls lib/trips.ts.new` → no such file.
- `npm run verify` green.
