---
id: B1626
title: "v2 merge-patch has no way to clear a scalar back to absent, and cover is never checked against the trip's own media"
type: ISSUE
priority: medium
complexity: medium
area: API v2
found: 2026-09-12T00:00:00Z
---

## Why

Three findings from rewriting `test/trip-details.test.ts` against the v2 trip
route (B1612). The first is its own bug; the second and third are one gap seen
twice.

### 1. `cover` is never checked against the trip's own media

`lib/api/v2/schemas/trip.ts` types `cover` as a plain optional string, and no
route compares it to what the trip actually holds. Any string is accepted and
written. v1 refused this (`invalid_cover`, still in `ERROR_CODES`: *"`cover`
must be a `src` this trip's own gallery already carries"*).

What it costs is visible rather than theoretical: the trips index and the
OG card render that `src` directly, so a typo is a broken image on the
journal's front page and in every link anybody shares.

### 2 and 3. Nothing can be cleared back to absent

- `cover: ""` does not clear the cover. It is a valid string, stored as-is,
  and `trip.cover ?? pickCover(days)` never falls through — so the auto-pick
  the declined case relies on is unreachable once a cover has been set.
- `accent` cannot be reverted once chosen. Declining an already-set `accent`
  hits `checkRequiredOrDeclined`'s "both provided and declined" conflict,
  because nothing clears the stored value when a decline arrives.

Both are the same missing convention: **v2's merge-patch has no way to say
"remove this field"**. Omitting a key means "unchanged"; there is no agreed
spelling for "make it absent again". v1 used `null` or `""` per field, which
is exactly the sort of per-field vocabulary v2 set out to replace — so the
answer is not to copy it back, it is to decide the one convention.

This is the same shape as B1616 (a stored answer no patch can retract) and
should probably be solved with it.

## Work

Decide the convention once, and apply it in the shared write path so every
resource and both doors inherit it. The obvious candidate is `null` meaning
"remove", since JSON Merge Patch (RFC 7386) already means exactly that and the
schemas would state it per nullable field rather than by prose. **That is a
contract change and needs a row in `docs/v2-migration/06-contract-deltas.md`
and the owner's agreement** — it is not a build decision.

Separately and immediately buildable: check `cover` against the trip's media
at the door (it needs the stored document, so it belongs in the route/shared
write path, not the schema) and refuse with `invalid_cover`.

Not doing: reintroducing v1's per-field clearing vocabulary.

## Acceptance

- A `cover` naming a photograph the trip does not have is refused, not
  written.
- One documented way to clear a scalar back to absent, working for `cover`,
  `accent`, `tagline` and `intro` alike, with its deltas row.
- `test/trip-details.test.ts`'s three banner-ed blocks pass with no assertion
  weakened.
