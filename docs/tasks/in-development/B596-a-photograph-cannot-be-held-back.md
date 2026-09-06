---
id: B596
title: A photograph cannot be held back from readers the trip lets in
type: FEATURE
priority: medium
complexity: high
area: media, visibility, api, helper-repo
found: "2026-09-06T14:34:30Z"
started: "2026-09-06T14:35:12Z"
session: 0959df30-510b-43ee-8ed3-a20d82a13c45
claimed: "2026-09-06T14:35:12Z"
---

# B596 — A photograph cannot be held back from readers the trip lets in

## Why

Visibility is decided per trip and nowhere finer. A trip that is `guest` or
`public` shows every photograph on it to everyone that value lets in, so one
picture that should not be there is a reason to close the whole trip — or to
delete it. There is no third answer today.

`app/[user]/media/[...path]/route.ts:10` already says where the answer goes:
*"Serving it through a route rather than copying it back into `public/` at
build time is also what makes per-trip and per-photo visibility possible
later: this is the single place a permission check will go."* The gate was
designed and never built.

Cost of not having it: the owner's only tools are the trip's own visibility
and the delete key. A family album with two pictures nobody outside the trip
should see is a private trip, which means the family cannot read it either.

## Work

**The field.** `gallery[].visibility: guest | private`, absent by default. No
`public` value — a photo narrows and never widens, so the effective
requirement is `max(what the trip already requires, the photo's label)` and a
`guest` photo on a `private` trip stays private-level. An unrecognised value
reads as `private`, the fail-closed rule a trip's `visibility` already gets.

Three ordered levels: `public` < `guest` < `person` (on the trip, or the
owner — which since B480 includes the instance's admin).

**One read chokepoint, not forty-five.** `ReadOptions` (`lib/entries.ts:133`)
gains `viewer?: ViewerLevel`, **defaulting to `public`**. `visible()` — the
function that already strips drafts — strips gallery items above the viewer's
level, returning fresh entry objects so the parse cache is never mutated.
Every consumer of `entry.gallery` and `getAllMedia` inherits it untouched
(day page, gallery, `story.json`, `StructuredData`, the OG image,
`narratedCut`, the markdown twin, `WorldMap`), and the default is closed, so a
path nobody updated fails safe rather than leaking.

`lib/tripGate.ts` gains `readFor(trip)` returning `{ includeDrafts, viewer }`
from one gate call; the ~30 `draftsVisibleTo` + `{ includeDrafts }` pairs
convert to it. B327 is why: nine reading paths were changed and the tenth was
missed, and the tenth was the media route. One function decides the level and
nothing else asks.

Counts follow the filter — a gallery showing 8 of 10 says 8. Nothing tells an
unauthorised reader that something was withheld; no placeholder, no count of
what is missing.

**The file gate.** In the media route, after the trip gate and the draft
check: resolve the day slug and src, find the gallery item, compare its label
to the viewer's level, 404 on refusal — consistent with every other refusal
there, and it tells a prober nothing. `?w=` derivatives are the same route and
are covered.

`Cache-Control: private, no-store` for any labelled photo. The bytes do not
vary by reader; the *status* does, and a shared cache holding the 200 would
hand it to the next person who asks. Same reasoning as the draft case
immediately above it.

**Write doors.** The agent is the editor, so a field it cannot set does not
exist:

- `PATCH …/days/<slug>` gains `photoVisibility: { "<src>": "guest" | "private"
  | null }`, null clearing. Generalise `spliceCaptions`
  (`lib/api/entries.ts:818`) from "the caption field" to "a named scalar on the
  item" — close to what it already is.
- `POST …/media` gains a `visibility` array parallel to `captions`, in both the
  JSON and the multipart form.
- Authority is the authority to write the day: owner or trip-scoped token. A
  trip token may label a photo and still may not publish.
- Readable back through `GET …/days/<slug>`, which already returns
  `entry.gallery`. That route is bearer-only and its caller is therefore always
  person-level — document that rather than leave it inferred.
- `PHOTO_VISIBILITIES` exported and *imported* by `lib/api/openapi.ts`;
  `/agent.md` gains the field and the narrows-only rule. One refusal documented
  beside the success.

**The digest is the non-obvious leak.** `lib/digest/dayLetter.ts:410` reads
with `includeDrafts: true` and picks the day's first image, and its recipients
are journal-wide contacts — guest-level — with per-recipient rights already
computed (`showCosts`). The photo pick must read at *the recipient's* level.
Without that, a private photograph is mailed to everyone subscribed.

Photobook and postcard pages are owner-only surfaces and read at `person`
level, so the owner's own book includes everything they labelled.

**The helper repo** (`fernscout-helper/.claude/skills/icloud-export/`): the
per-photo cell in `review.mjs` keeps its Keep toggle and gains a three-way
control — Everyone / Guests only / Private — saved to
`review.photos[file].visibility`. `build.mjs` emits `visibility: "guest"`
inside the gallery item when set. `SKILL.md` covers it in step 4's
instruction and notes in step 6 that a label narrows and never widens.

**Not doing:** a placeholder telling a reader that photographs were withheld
(it announces to anyone who opens the URL that restricted material exists on
that day); per-photo *widening*; a label on the trip's cover image, which is
its own field.

## Acceptance

- `test/photo-visibility.test.ts` covers the level ordering, that `visible()`
  strips correctly at each level, that narrows-only holds (a `guest` label on a
  a `private` trip stays hidden from a journal guest), and that the parse cache
  is not mutated.
- A media-route test walks one labelled photograph through all three levels:
  404, 404, 200.
- A labelled photograph is absent from the gallery page, the day page and
  `story.json` for a reader below its level, and present for one at or above
  it.
- `npm run verify` green, `test/openapi-contract.test.ts` included.
