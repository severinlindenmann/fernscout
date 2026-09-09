---
id: B980
title: Correcting a day means leaving it for a wizard, when the day itself is what the owner is looking at
type: FEATURE
priority: high
complexity: high
area: day page, owner tools
found: "2026-09-08T16:10:32Z"
started: "2026-09-08T16:22:01Z"
session: a4bbb185-df72-4880-be96-ae7a2513e05a
claimed: "2026-09-08T16:22:01Z"
---

# B980 — Correcting a day means leaving it for a wizard, when the day itself is what the owner is looking at

## Why

"Correct or remove" on a day is a link to `/agent/<user>?trip=…&slug=…` —
the wizard (B816). So the owner, standing on the day they are reading, with
the paragraph they want to fix in front of them, is taken to another page that
re-asks the day from the beginning through a model.

Everything the correction needs is already an API: `PATCH
/api/v1/<user>/trips/<trip>/days/<slug>` writes title, date, time, location,
content, captions and `photoVisibility` (`EDITABLE_DAY_FIELDS`,
`lib/api/entries.ts`), `POST .../publish` and `.../unpublish` move it on and
off the site, and `PATCH /api/v1/<user>/trips/<trip>` writes the trip's
`visibility`. There is no browser path to any of them.

This is not a CMS (decision 24): a person is not being given a form that
composes a day out of fields. It is the correction of a day that already
exists, by the person whose day it is, on the page where they noticed it —
the same thing the wizard does, minus the round trip through a model for
"the time was 14:00, not 15:00".

## Work

**Round 1 and round 2 are merged.** What they built:
`app/[user]/trips/[trip]/day/[slug]/edit/route.ts` (the owner's cookie door
onto `editEntry`), `.../photos/route.ts` (onto `storeUploads`,
`attachGallery`, `detachGallery`), `components/EditDay.tsx` (the panel), and
`test/edit-the-day.test.ts`. The tile in `OwnerTools` opens the panel on the
day page and stays the wizard link on the trip overview.

Round 1 — the words and the day's own facts:

- An edit mode on the day card, opened by the existing tile, closed by
  cancel. One panel, the day's fields as inputs: per update the title, the
  time and the markdown content; for the day, the date and the location.
- Save is one `PATCH` per changed update, then a refresh of the page's data.
- Publish / unpublish through their own buttons and their own endpoints —
  never folded into save, because that is the second call B28 made separate
  on purpose, and it is owner-only.

Round 2 — the pictures:

- Per gallery item: the caption, `visibility` (absent / guest / private),
  and removal. `PATCH` with `captions` and `photoVisibility`.
- Adding photographs through the existing media endpoint.

Round 3 — built:

- Taking a day off the site. `app/[user]/trips/[trip]/day/[slug]/unpublish/route.ts`
  is the owner's cookie door onto `unpublishEntry` — same three properties as
  `edit/route.ts` beside it: not under `/api/v1/`, owner's cookie only (any
  `Authorization` header, trip-scoped or not, is refused outright before
  `isOwner` is even asked), same writer an agent uses. `EditDay` gained a
  "Take this day off the site" button behind its own `ConfirmPanel` — a
  separate press from Save, never folded into it (B28) — that unpublishes
  every update of the day that is not already a draft, one call each, so the
  day's own `DraftNotice` (which asks whether *every* update is a draft)
  actually lights up. `OwnerTools`'s tile went back to saying "Correct or take
  down" on both branches, since both can now back the words up — B1013 had
  split the label for the round the panel had not been built yet.
- The trip's own `visibility` and `listed`, from the same panel.
  `app/[user]/trips/[trip]/visibility/route.ts` is the owner's cookie door
  onto `patchTripVisibility` (the same writer `PATCH .../trips/<trip>/visibility`
  uses over the API — the general trip PATCH refuses these three fields on
  purpose and points at the dedicated door). `EditDay` carries a select for
  `visibility` (private/guest/public) and a checkbox for `listed`, shown only
  once the trip is public, seeded from `trip.trip.visibility`/`listed` via a
  new `tripVisibility` prop from `StoryPager`. Sent as its own PATCH, and only
  when either field actually changed.

Not doing: a confirmation panel on the trip-visibility change specifically —
Save already asks once, the same as the day's own per-update `visibility`
field beside it, and the widening warning the API route's response carries is
not surfaced further than that. A capture if a reviewer wants the widening
called out more loudly.

Not doing: writing a day from nothing in the browser. Creating a day stays
the agent's, which is decision 24. This edits what exists.

## Acceptance

As the owner on a published day: press "Correct or remove", change the
title and a paragraph, save, and the page shows the change without a reload
of a different URL. Change the time on the second update of a two-update day
and only that update is written. Unpublish, and the day carries the draft
banner. A reader who is not the owner sees no edit affordance and gets a 403
from every route it uses. `npm run verify` green.
