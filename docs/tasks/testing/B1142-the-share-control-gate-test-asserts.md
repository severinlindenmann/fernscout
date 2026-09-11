---
id: B1142
title: The share-control gate test asserts proximity with a character window that is widened every time the file grows
type: ISSUE
priority: low
complexity: low
area: tests
found: "2026-09-09T18:36:30Z"
started: "2026-09-11T15:47:59Z"
merged: "2026-09-11T16:05:06Z"
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

Took the first, cheaper option: render, don't measure.

`test/invite-to-read.test.ts` (now `.tsx`, since it renders) dropped the
`day`/`trip` proximity assertion's day half — `expect(day).toMatch(/trip\?\.
canPublish[\s\S]{0,2000}<OwnerTools/)` — and replaced it with a new describe
block, "the day card's owner-only block": it renders `StoryPager`'s exported
`DayCard` inside `LocaleProvider` + `CurrencyProvider` + `TripProvider`, once
with `canPublish={true}` and once with `canPublish={false}` (mocking
`next/link` the same way `test/trip-switcher.test.tsx` does), and asserts
`OwnerTools`' own marker — the translated `owner.onlyYou` text
("Only you can see this") — is present for the owner and absent otherwise.
That is the actual claim ("nothing between the gate and the block reopens it
for a non-owner"), and it is now a fact about what renders rather than about
how many characters sit between two strings: unrelated growth to `EditDay`'s
props does not move it, and a second gate or an early return inserted before
`<OwnerTools>` that would hide it from a real owner makes the "renders for the
owner" case fail.

**The trip half is untouched** — `app/TripStory.tsx`'s own `trip?.canPublish
{0,80}<OwnerTools` proximity check stays exactly as it was per the ticket's
own instruction, since the gate and the block sit right beside each other
there in one short function and `{0,80}` still means something.

**What else covers this gate**, checked before touching the file: nothing else
does. `test/edit-day-initial-drop.test.tsx` renders `EditDay` directly but
never touches `StoryPager`/`DayCard` or `OwnerTools`'s reachability; no other
test file renders `DayCard` with a `TripProvider` at all. The character-window
assertion in the day branch was the sole guard on this gate, which is exactly
why replacing rather than deleting it mattered — the new render-based test is
the guard now, not merely a rewording of the same check.

## Acceptance

Add a second gate or an early return between `canPublish` and `<OwnerTools>` in
the day branch and the test fails. Add fifty lines of unrelated props to
`EditDay` and it passes with no number edited. `npm run verify` green.
