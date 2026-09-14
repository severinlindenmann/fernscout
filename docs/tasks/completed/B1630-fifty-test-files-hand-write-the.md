---
id: B1630
title: Fifty test files hand-write the storage format; there is no shared content fixture
type: CHORE
priority: high
complexity: high
area: Testing
found: "2026-09-12T21:35:00Z"
merged: "2026-09-13T01:48:16Z"
completed: "2026-09-14T16:32:18Z"
---

# B1630 — Fifty test files hand-write the storage format; there is no shared content fixture

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

---

## The real scope, measured 2026-09-13: 150 files, not 48

The original survey grepped for local helpers **named** `writeTrip` or
`writeEntry` and found 52. That name was the wrong thing to search for.
Counting files that hand-write markdown content by any spelling:

```
grep -rln 'writeFileSync' test/*.ts test/*.tsx | xargs grep -ln '"---"|trip\.md|\.md`'
→ 150
```

`test/media-upload.test.ts` is the shape that was missed: its helper is called
`writeDay`, writes `entries/${date}-${slug}.md` inline, and the survey never
saw it. There are roughly a hundred more like it.

That does not change the plan, only its size — and it strengthens the
argument for the plan: a hundred and fifty copies of the storage format is
the disease at full extent, and repointing them onto one helper is worth
doing for its own sake, not merely to unblock B1598.

**42 files are done.** The remaining ~108 are mechanical: same helper, same
pure-refactor discipline, batches of ten with a green run after each.

The six known resisters stand, and their reasons generalise — expect more of
each kind: a one-character username `isValidUsername` refuses; fixtures that
are *deliberately malformed* to prove a reader fails closed; a `writeTrip`
called twice on one id to simulate a hand-edit; and a subject (`reminder:`)
with no field in `createTrip` at all.
