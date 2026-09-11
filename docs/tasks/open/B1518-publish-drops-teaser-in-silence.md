---
id: B1518
title: fernscout-helper's publish drops teaser in silence, so a closed trip never appears on /trips
type: ISSUE
priority: medium
complexity: low
area: helper, publish
found: "2026-09-11T19:40:00Z"
---

# B1518 — fernscout-helper's publish drops teaser in silence, so a closed trip never appears on /trips


## Status — fixed in fernscout-helper, cause not addressed

The immediate bug is **fixed and committed** in `fernscout-helper`
(`publish.mjs`): `teaser` now rides the create call and the visibility PATCH.
Verified against a live trip — `set visibility {"visibility":"guest","teaser":true}`,
and the trip appears on `/severin/trips`.

**Do not close this ticket on that.** The "Work" section below is about the
*cause*: three hardcoded key lists in `publish.mjs` that fall behind
`content-model.json`. Since this ticket was written, the same class of bug
turned up again in B1525 (`cover`). That part is untouched and is the reason
this is still open.

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
