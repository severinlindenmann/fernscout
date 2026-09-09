---
id: B1142
title: The share-control gate test asserts proximity with a character window that is widened every time the file grows
type: ISSUE
priority: low
complexity: low
area: tests
found: "2026-09-09T18:36:30Z"
---

# B1142 — The share-control gate test asserts proximity with a character window that is widened every time the file grows

## Why

`test/invite-to-read.test.ts:51` checks that the owner-only share control stays
inside the `canPublish` gate by asserting the two appear near each other in the
source:

```js
expect(day).toMatch(/trip\?\.canPublish[\s\S]{0,600}<OwnerTools/);
```

It is a proximity heuristic standing in for a real claim — *nothing between the
gate and the block reopens it* — and the substitute has a moving part. B980
round 1 put the edit panel between the two and the comment was amended to say
the markers are now further apart. Round 3 widened `EditDay`'s props again on
2026-09-09 and the window went from 600 to 2000 characters to keep passing.

Each widening is individually correct and the direction is one-way. At 2000
characters the assertion no longer distinguishes much: a second gate, an early
return, or a genuinely relocated block would all fit inside the window and the
test would still be green. The trip half beside it is still `{0,80}` and does
mean something, which is what makes the day half's drift visible.

Nothing is known to be wrong today — round 3's verify was green and the gate is
correct by reading. This is about a test that gets weaker on a schedule set by
unrelated edits, in a file whose subject is who may see a closed trip.

## Work

Assert the property instead of the distance. Options, cheapest first:

- Render the component with a non-owner reader and assert `OwnerTools` is
  absent — the actual claim, and the suite already renders `EditDay` elsewhere
  (`test/edit-day-initial-drop.test.tsx`), so the machinery exists.
- If it stays a source check, parse rather than measure: find the `canPublish`
  block and assert `OwnerTools` is within *it*, so the assertion is about
  nesting and cannot be loosened by unrelated growth.

Keep the trip half as it is; `{0,80}` is tight enough to still mean something,
and changing a passing assertion that works buys nothing.

## Acceptance

Add a second gate or an early return between `canPublish` and `<OwnerTools>` in
the day branch and the test fails. Add fifty lines of unrelated props to
`EditDay` and it passes with no number edited. `npm run verify` green.
