---
id: B1749
title: There is one circle of guests, so a trip held back from the wider circle is held back from close family too
type: FEATURE
priority: medium
complexity: medium
area: access, grants, visibility
found: "2026-09-14T19:43:24Z"
---

# B1749 — There is one circle of guests, so a trip held back from the wider circle is held back from close family too

## Why

A journal has exactly two circles: everyone (`visibility: public`) and the
people the owner has approved (`guest`). A third value, `private`, means *no
reader at all* — `isOpenToApprovedGuest` in `lib/access.ts:83` returns false
for it, and `PHOTO_VISIBILITIES` (`lib/photos.ts:43`) is the same two rungs
one level down.

That collapses two audiences the owner actually has. Close family and a
handful of old friends are not the same set of people as the wider circle of
friends, colleagues and acquaintances who get let in over time — but the
software offers one grant, so a trip, a day or a photograph that should not go
to the wider circle is held back from the close one as well. In practice the
owner either over-shares or marks it `private` and nobody sees it, including
the people it was for. B275 is the same pressure from a different side: one
private afternoon forces a whole trip guests-only.

## Work

A second tier of approval, between `guest` and nobody. Decided (2026-09-14):

- **It is a scope on the existing grant, not a new list.** `access_grants`
  already carries a `scope` column, read only as `"read"` today
  (`lib/grants.ts:63`). A close-circle contact holds a scope that also opens
  `private` content. A contact is one tier or the other, never both.
- **It unlocks exactly what a guest sees, plus everything marked `private`** —
  trips, days and photographs alike. No per-trip exception list, no
  owner-defined groups; both were considered and are deliberately out of
  scope. If the owner later wants "everyone but this one trip", that is a new
  ticket, not a reason to build groups now.
- `lib/access.ts` grows the predicate the same way it holds
  `isOpenToApprovedGuest` — one function, every surface calls in here. The
  same for `lib/photos.ts`'s per-photo rung and `lib/tripGate.ts`. Do not add
  a second answer anywhere; the comment at the top of `lib/grants.ts` records
  what happened last time three readers each decided for themselves.
- The owner needs to be able to promote and demote a contact from the access
  panel, and to see which tier each contact is in without reading the
  database.
- The word shown to a reader and to the owner is a naming decision, not
  necessarily `private` — `private` already means "closed to everyone" in
  trip frontmatter, and reusing it for a *person* would make the two senses
  collide. Pick one term and use it in UI, API and docs; English, German and
  Hungarian entries are required in `site/locales/`.
- API: a promoted contact must be settable and readable back over
  `/api/v2/**`, from the validator's own enum rather than a copied list, and
  `/api/v2/openapi.json` must say what the tier opens. Run `keep-the-contract`.
- Security review path before merge — this changes who may read what.

Out of scope: named groups, per-trip exceptions, expiring tiers.

## Acceptance

- The owner can promote an approved contact to the close tier and demote them
  again, from the site, and see the tier in the access list.
- A signed-in close-tier contact can open a `visibility: private` trip, sees
  `visibility: private` days inside a shared trip, and sees photographs marked
  private. A signed-in ordinary guest, given the same URLs, is refused each of
  them — not a partial render, and not a listing that leaks the title.
- A demoted contact loses all three in the same page load.
- `/api/v2/openapi.json` documents the tier; setting it over the API and
  reading it back returns what was written.
- A test covers the refusal for the ordinary guest at trip, day and photograph
  level, so the gate cannot be narrowed later without a red suite.

## Related

B275 (one private afternoon forces a whole trip guests-only) and B1662 (a v2
 day's private/guest photograph visibility is not enforced by the file-serving
route) both touch the same gate; B1662 in particular must be true before this
tier means anything for photographs.
