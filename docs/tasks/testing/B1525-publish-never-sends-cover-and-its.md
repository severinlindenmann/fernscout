---
id: B1525
title: publish never sends cover, and its SKILL.md still says eight trip fields have no door
type: ISSUE
priority: medium
complexity: low
area: helper, publish, docs
found: "2026-09-11T20:40:00Z"
merged: "2026-09-12T12:51:31Z"
---

# B1525 — publish never sends cover, and its SKILL.md still says eight trip fields have no door


## Status — done in fernscout-helper; moved to testing for a person to confirm

Fixed in `fernscout-helper` commit `a62c659` ("B1525 B1529: publish sends all
nine trip fields, cover translated to the instance's slug, and
--replace-media"). `publish.mjs` now PATCHes all nine trip fields on an
existing trip via `TRIP_GENERAL_PATCH_KEYS` / `TRIP_DEDICATED_DOORS`, sends
`cover` after media upload once each entry's real (instance) slug is known and
translates it from local terms, and `SKILL.md` was rewritten to match. Found
stale in `fernscout`'s `docs/tasks/open/` on 2026-09-12 — the earlier
hand-written `curl` workaround below predates this fix. Verify: publish a trip
with a `cover:` set in `trip.md` and confirm it reaches the site without a
hand-written call, and that the other eight fields (title, tagline, start,
end, accent, costsVisibility, intro, translations) update on a re-publish.

Note for whoever picks it up: `cover` has an ordering constraint the other seven
do not. Its value must be a `src` the trip's gallery already carries, so it can
only go out **after** the media upload in the same run.

## Why

Found on 2026-09-11 while setting a cover on a published trip.

`fernscout-helper`'s `publish/SKILL.md` states:

> `title`, `start`, `end`, `tagline`, `accent`, `intro` and `translations` have
> no door yet on an existing trip (B245, in the fernscout repo) — editing those
> in `trip.md` after the trip is created does not reach the site, and the run
> prints a warning naming whichever of them it finds disagreeing.

That is out of date. `PATCH /api/v1/{user}/trips/{trip}` exists and its own
description says so:

> Eight fields of a trip nothing could write until B622 (four), B245 (`cover`)
> and B907 (`accent`, `costsVisibility`, `intro`): `title`, `tagline`, `start`,
> `end`, `cover`, `accent`, `costsVisibility` and `intro`.

So the helper warns about a limitation that was lifted in three separate pieces
of work, and declines to send fields the instance has been accepting since.

`cover` is the one that bites. It **cannot** be set when a trip is created —
the media does not exist yet — so the only way it is ever set is afterwards,
which is exactly the path the helper does not have. A `cover:` in `trip.md`
validates cleanly (the content model lists it), publishes without a word, and
never reaches the site. Same failure shape as B1518 and the same fix.

It had to be set with a hand-written `curl`, which is the tell.

## Work

- Send the eight fields through `PATCH …/trips/{trip}` on an existing trip, and
  drop the warning that stands in for it.
- `cover` needs one extra step the others do not: its value must be a `src` the
  trip's gallery already carries, so it can only go out **after** the media
  upload in the same run, not with the other trip fields at the start.
- Rewrite the `SKILL.md` paragraph and the field table.

**And the thing worth fixing properly**: this is now the third field in two
days that the helper silently declined to send (`teaser`, B1518; `cover` here),
each because a hardcoded key list fell behind the instance. `AGENTS.md` is
explicit that these tools follow the instance rather than define anything, and
three hardcoded lists in `publish.mjs` are the exception to that. B1518's
"Work" section proposes driving them from `content-model.json` instead; this
ticket is the second vote for it.

## One more thing, for whoever picks this up

A trip's `cover` on the instance is a server path built from the **day slug the
instance assigned**, which comes from the day's title:

```
/severin/media/thailand-2025/saechs-stund-jetski/02.jpg
```

The same photograph in the local folder is

```
/media/thailand-2025/jetski-tour/02.jpg
```

— the helper's own folder name, which comes from the day's *place*. The two
have no reason to agree and in this journal they do not. So `cover:` cannot
simply be copied in either direction, and a `cover:` written locally in local
terms has to be translated on the way out. Worth deciding deliberately rather
than discovering.

## Acceptance

- `cover:` in `trip.md` reaches the site on a trip that already exists.
- The other seven fields reach it too, and the stale warning is gone.
- `SKILL.md` describes what the instance actually accepts today.
- A local `cover:` value is resolved to the instance's own src rather than sent
  verbatim, or the mismatch is refused with a message that explains it.
