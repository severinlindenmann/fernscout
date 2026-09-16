---
id: B1412
title: the delete-trip link sits on the trip page, where a reader is reading, rather than with the trip's other owner controls
type: CHORE
priority: medium
complexity: low
area: trips / owner tools
found: "2026-09-10T20:07:49Z"
---

# B1412 — the delete-trip link sits on the trip page, where a reader is reading, rather than with the trip's other owner controls

## Why

Asked for directly. On `/<user>/trips/<trip>` the owner's tool block ends with
*"Diese Reise löschen"* (`components/OwnerTools.tsx:193` →
`components/DeleteTrip.tsx`, B1321). The owner's own view of a trip is also the
page they open to *read* it, and the one irreversible act in the journal sits
at the bottom of it every time.

`/<user>/me` already has the place it belongs. Under **Was du lesen kannst**
each trip is a row, and an owner's row carries a pencil that opens `TripEditor`
inline (`app/[user]/me/MePageContent.tsx:203`) — the panel that is already
about changing a trip rather than reading one. The population matches exactly:
`editableTrips` is built only for `viewer.owner` (`app/[user]/me/page.tsx:170`)
and `app/[user]/trips/[trip]/delete/route.ts` is `isOwner` on a cookie only.

## Work

- Remove `DeleteTrip` from `OwnerTools`; the trip page keeps its other tools.
- Put it inside the trip's edit panel on `/<user>/me`, last and quiet — the
  same shape B1321 chose: a text link, never a tile, with `ConfirmPanel`
  naming the inventory before the second press.
- Not doing: any change to `app/[user]/trips/[trip]/delete/route.ts`, to what
  it refuses, or to the mail path an agent still has to take. Not doing:
  anything about deleting a whole journal.
- `me.tripEdit`'s aria-label and any wording around the panel should still be
  true once it can delete; check en/de/hu together.

## Acceptance

Sign in as the owner. `/<user>/trips/<trip>` shows the owner tools with no
delete link anywhere on the page. `/<user>/me` → a trip row's pencil → the edit
panel offers delete, and pressing it through the confirmation removes the trip.
A guest and a person on the trip see no delete control on either page.
