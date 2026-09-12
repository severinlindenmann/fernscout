---
id: B1518
title: fernscout-helper's publish drops teaser in silence, so a closed trip never appears on /trips
type: ISSUE
priority: medium
complexity: low
area: helper, publish
found: "2026-09-11T19:40:00Z"
started: "2026-09-11T21:35:13Z"
merged: "2026-09-11T21:41:52Z"
---

# B1518 — fernscout-helper's publish drops teaser in silence, so a closed trip never appears on /trips


## Status — done, in fernscout-helper (merged to main there, commit ad5cac6)

The immediate bug was fixed first: `teaser` now rides the create call and the
visibility PATCH. Verified against a live trip — `set visibility
{"visibility":"guest","teaser":true}`, and the trip appears on
`/severin/trips`.

**The cause is now fixed too.** Took the "failing that" option from Work
below, since the "drive the create body from content-model.json" option would
have meant a much larger rewrite of `publish.mjs`'s create path for a ticket
whose actual damage was always at *update* time.

`shared/tripFields.mjs` (new) exports `TRIP_UPDATE_DOORS` — one list of every
`trip.md` key that has a door once a trip already exists — and
`TRIP_NO_UPDATE_DOOR`, the three keys (`id`, `status`, `test`) that
deliberately have none. `publish.mjs` imports it instead of defining its own
list (its general PATCH loop is `TRIP_UPDATE_DOORS` minus the keys with their
own dedicated door). It could not import `publish.mjs` itself for this list —
that file runs its whole publish flow at the top level, so importing it would
execute a real publish as a side effect — a shared module was the only place
both files could read the same list from.

`validate-content` diffs `content-model.json`'s own known-key list for
`trip.md` against `TRIP_UPDATE_DOORS`/`TRIP_NO_UPDATE_DOOR` and warns on
whatever is left over. Confirmed the check actually fires: removed `cover`
from the list, re-ran validate, got `cover has no update door in
publish.mjs`, put it back.

Also caught and fixed while running the regression suite: `content-model.
snapshot.json` had drifted from B1526/B1533's deploy earlier the same
session (a new route, changed descriptions) — unrelated to this ticket but
the same `node shared/selftest.mjs` run that verifies this fix also verifies
that snapshot, so it would have failed either way. Refreshed with
`node shared/snapshot.mjs`.

`node shared/selftest.mjs --offline`: 70/70 green.

## Why

Hit live on 2026-09-11, publishing a `guest` trip that the owner wanted listed
as a locked card.

`teaser` is a real field. `content-model.json` lists it among `trip.md`'s known
keys, `POST /trips` accepts it, and `PATCH …/trips/{trip}/visibility` accepts it
— it is the documented way a closed trip says it exists without saying anything
about itself.

`fernscout-helper`'s `publish.mjs` carried it in neither place. The create call
copied a fixed list of keys that did not include it; the visibility patch only
fired when `visibility` or `listed` was present and only ever sent those two.

So a `trip.md` with `teaser: true` passed `validate-content` cleanly, published
with no warning, and the trip did not appear. Nothing anywhere said why. **The
failure mode is the bad one**: not a refusal, not a warning, but a field the
tools quietly declined to send.

Fixed in the helper's working tree the same day, in both paths.

## Work

The fix is done; what is worth doing here is stopping the next one.

The helper copies trip fields with a hardcoded key list in two places, and that
list will fall behind `content-model.json` again — this is the same class of
staleness that killed `model.mjs` and produced `content-model.json` in the first
place. `AGENTS.md` in the helper is explicit that these tools follow the
instance rather than defining anything, and a hand-kept list of which keys to
send is exactly the thing it warns about.

Candidates:

- Drive the create body from `content-model.json`'s `trip.md` known-key list
  rather than a literal in `publish.mjs`.
- Failing that, have `validate-content` warn when `trip.md` carries a key that
  the model knows and `publish.mjs` has no path for — the drift check it
  already does in the other direction.

Both are in the helper repo, not here; filed here because that is where the
backlog lives.

## Acceptance

- `teaser: true` in `trip.md` reaches the site on a new trip and on an existing one.
- A trip.md key the instance accepts and `publish.mjs` does not send produces a
  warning rather than silence.
