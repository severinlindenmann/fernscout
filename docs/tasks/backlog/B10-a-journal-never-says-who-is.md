---
id: B10
title: A journal never says who is writing it
type: FEATURE
priority: medium
complexity: medium
area: journal, trips, about
found: "2026-09-01"
---

# B10 — A journal never says who is writing it

## Why

Every journal knows exactly who it belongs to, and no reading page ever says
so. `content/<user>/config.json` carries `owner: { name, nickname, email }`
(`lib/users.ts`), and each trip carries `people:` — up to ten names and
addresses, resolved owner-first by `peopleOf()` in `lib/tripPeople.ts` and
formatted for display by `travellerNamesOf()` in `lib/site.ts:57`.

`travellerNamesOf` has exactly one caller: the costs page, twice
(`app/[user]/(trip)/costs/page.tsx:51` and
`app/[user]/trips/[trip]/costs/page.tsx:59`). So the only place a reader is
told who took the trip is the page about money, and only when costs are
visible to them. There is no `/about` route under `app/[user]/`, and the trip
intro prose in `trip.md` is about the journey, not about the people.

The reader this hurts is the one the `/me` page is written for — somebody who
opened a link from a mail, is three days into reading about strangers in
Vietnam, and cannot find out whose family holiday this is. It is also what a
public journal needs before it is worth advertising on the landing page: a
site that lists journals without saying who is behind each one is a directory
of anonymous strangers.

Related: B20 is the same absence on `/me`, where the fix is one line of copy
rather than a page. This task is the page; do not do both in one change.

## Work

Decide the scope first, because "for either each trip or the journal" is two
different features and the answer changes the data model:

- **Journal-level** — one "about us" per `content/<user>/`, sourced from a new
  `about.md` beside `config.json`, rendered at `/<user>/about`. This is the
  one that pays for itself: it is who the journal is, and it holds for every
  trip in it.
- **Trip-level** — who was on *this* trip, which `people:` already records and
  which differs between trips in the same journal. Cheaper as a block on the
  existing trip overview than as a route of its own.

Recommendation: build the journal-level page, and put the trip's own
travellers on the trip overview using `travellerNamesOf` rather than opening a
second route. Revisit a per-trip page only if a trip turns out to need real
prose about its people.

Whatever the shape:

- Names and nicknames only. **No email address on any reading page** — the
  owner's address is in config so that mail can be sent, not so it can be
  published, and `people[].email` is a write-access key.
- It is content, so it is markdown in the content folder and it obeys the
  draft rule like everything else.
- The journal's `visibility` decides whether the page is advertised, not
  whether it exists; a private journal is unlisted, not locked.

## Acceptance

- A reader on the demo journal can reach a page that names Alex Berger without
  first opening the costs page.
- No email address appears in the rendered HTML of that page — assert it in a
  test, because the field is right there in the config object being passed in.
- `test/depersonalised.test.ts` still passes: nothing real goes in code.
- The page exists for a journal that has written no about text, or does not
  render at all. It must not appear as an empty heading.
