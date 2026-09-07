---
id: B621
title: The owner's own details sit on the wrong page, and a trip's title and dates cannot be changed by anybody
type: FEATURE
priority: high
complexity: high
area: me page, contacts page, trips
found: "2026-09-06T16:47:09Z"
started: "2026-09-06T16:47:40Z"
merged: "2026-09-06T17:08:14Z"
completed: "2026-09-07T13:12:31Z"
---

# B621 — The owner's own details sit on the wrong page, and a trip's title and dates cannot be changed by anybody

## Why

Two halves, both from watching the owner use what B619 shipped.

**The owner's own details are on `/{user}/me`, and belong with the address
book.** B619 put them there because that is where `ContactManage` already
rendered for everybody else, and for a guest that is right: `/me` is the only
page they have. The owner has `/{user}/contacts`, which is the page about
addresses, consents and who gets a postcard — theirs is one more row in that
book and reads as an afterthought on the access page. Moving it also takes the
one confusing thing off `/me`: an owner saw *Deine Angaben* directly above
*Das ist dein Tagebuch* and read the first as being about the journal.

**A trip's title and dates cannot be changed by anything.** The `PATCH` on
`/api/v1/{user}/trips/{trip}` says so itself, in the refusal it hands an agent
that guesses: *"A trip's title, dates and cover are still trip.md alone and no
call writes them."* Every other field of a trip got a door — `visibility`,
`rates`, `people`, `travellers`, `tracks` — and the three a person is most
likely to typo did not. A trip called "Alagrve 2026" is a `git push` away from
being fixed, which is the same shell B220 removed for a journal's title.

So: the pencil the owner asked for, next to each trip on their own page, and
the writer behind it that does not exist yet.

## Work

- **`lib/frontmatterScalar.ts`** — `spliceScalar` and `frontmatterLineOf`,
  moved out of `lib/api/tripVisibility.ts` rather than copied. It is the only
  thing here that edits one frontmatter line while leaving the prose, the key
  order and every other key exactly as they were, and it is about to have a
  second caller. `tripRates.ts` keeps its own: that one splices a *block*, not
  a scalar, and the two are not the same function wearing different names.
- **`lib/api/tripDetails.ts`** — `patchTripDetails(ref, body)` for `title`,
  `tagline`, `start` and `end`. Same shape as `patchTripVisibility` beside it:
  validate, splice, re-parse with `matter()` before writing so a corrupting
  edit writes nothing, refuse rather than coerce. `title` cannot be cleared;
  `tagline` cleared removes the key; dates are `DATE_RE` and `end` may not
  precede `start`.
- **`PATCH /api/trip`** — cookie, owner only, `{user, trip, title?, tagline?,
  start?, end?, visibility?}`. The same door `/api/journal` is and for the same
  reason. Visibility is *not* reimplemented: it forwards to
  `patchTripVisibility`, which already carries `listed`, `teaser`, the
  refusals and the `widened` note.
- **`/{user}/me`** — a pencil on each trip in *Was du lesen kannst*, owner
  only, opening the four fields and the visibility select in place. Widening
  who may read a trip is one click on a `<select>`, so the form asks for a
  second one: the note `patchTripVisibility` already returns is shown, and the
  save is a confirm rather than a save. Nobody else sees a pencil — a person
  on a trip may write days into it, and what the journey is called and who may
  read it stays the owner's.
- **`/{user}/contacts`** — the owner's own details, the *anlegen* button and
  the form, moved from `/me` whole. `/me` keeps it for everybody who is not
  the owner, which is what it was built for.

**Not doing:** the cover photograph, `status`, `accent`, `listed` and
`teaser`. The first is a photograph and belongs where photographs are chosen;
the rest are either derived from the dates or already have a door an agent
uses. Ask before adding one; a settings form that grows every field is the CMS
decision 24 says this does not have.

## Acceptance

- `/{user}/contacts` carries the owner's own details, and `/{user}/me` does
  not — while a signed-in guest still edits theirs on `/me`.
- A pencil on each trip on `/me`, owner only, that renames it, retitles it,
  moves its dates and changes who may read it. The header and the trip's own
  page show the new title after a reload.
- `end` before `start` is refused; a cleared title is refused; a cleared
  subtitle removes the key. `trip.md`'s prose and every key the form does not
  name survive a save byte for byte.
- Making a `private` trip `public` requires a second, explicit press, and the
  sentence the API already returns about what that opens is on screen before
  it happens.
- `PATCH /api/trip` answers 403 to a guest, to a person on the trip, and to
  nobody at all.
