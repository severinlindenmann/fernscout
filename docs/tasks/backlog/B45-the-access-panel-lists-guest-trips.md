---
id: B45
title: The access panel lists guest trips the reader cannot actually open
type: ISSUE
priority: medium
complexity: low
area: viewer, access
found: "2026-09-01"
---

# B45 — The access panel lists guest trips the reader cannot actually open

## Why

`test/viewer.test.ts` states the property the access panel is supposed to have:

> The property that matters is that the panel never widens access: it reports
> what `mayReadTrip` would already allow, and being told about a trip you
> cannot open is the same leak as showing it in a list.

It does not hold for a `visibility: guest` trip. `resolveViewer`
(`lib/viewer.ts`) lists one for any active contact; `mayReadTrip`
(`lib/tripGate.ts:26`) lets nobody into one without the trip password cookie,
because the only doors it knows are `isTravellerOn` and `verifyTripToken`.
Being an approved contact is not one of them.

So an approved reader opens `/<user>/me`, is told "Vietnam 2026 — guest, you
were invited", clicks it, and lands on a password box. That is precisely the
harm `lib/digest/visibility.ts` refuses to cause on the other surface — *"a
mail saying '3 new days in Vietnam' that leads to a password box is worse than
no mail"* — and the access panel does it on every page load.

Found while building B35, which removed the per-trip arm of the same
condition. B35 did not change this: the arm it removed was dead, and the panel
listed guest trips to active contacts before and after. The over-report is
older than both.

## Work

Two shapes, and which one is right depends on B41 and B39, so this is very
likely their tail rather than its own change:

- **B41** makes a guest a guest of the journal. If it also teaches
  `mayReadTrip` that an active contact may open a `guest` trip, the panel
  becomes correct without being touched, and this task is closed by
  verification rather than by code.
- **B39** removes trip passwords outright. `verifyTripToken` then stops being
  the only door, and the same question is answered there.

If neither lands first, the narrow fix is for `resolveViewer` to ask the same
question `mayReadTrip` asks, rather than a different one that happens to be
more generous — the panel exists to report an answer, not to compute a second
one.

Check the sibling surfaces while here: `listableTrips` and the trip switcher
draw a similar distinction and may have the same gap.

## Acceptance

- A reader who cannot open a trip is not told it exists — for every value of
  `visibility`, and demonstrated against the real `resolveViewer` (the
  `describe` added in B35 runs it against a database and a session).
- `test/viewer.test.ts`'s stated property is either true or rewritten to say
  what is actually guaranteed.
- Closing this by verifying B41 or B39 already fixed it is a valid outcome, and
  the note saying so belongs in this file.
