---
id: B245
title: A trip's trip.md cannot be changed after the trip is created
type: ISSUE
priority: medium
complexity: medium
area: trips, api
found: "2026-09-04T09:04:59Z"
started: "2026-09-07T11:06:12Z"
merged: "2026-09-07T11:32:22Z"
---

# B245 — A trip's trip.md cannot be changed after the trip is created

## Why

**Partly overtaken, 2026-09-05.** Three of the four fields below now have a
door of their own: `PATCH .../trips/<trip>/rates`, `.../visibility` (which
writes `visibility` and `listed`) and `.../costs`. `PATCH` on the trip itself
answers 405 and names them (B293). What is still writable only by editing
`trip.md` is **title, dates, `people:` and `cover`** — and `people:` is the
one that matters most, because it is write access. Read the list below with
rates and visibility struck out.

**Narrowed again, 2026-09-05.** `people:` — and `travellers:`, which this
ticket never listed — are B524's, with a door each. What is left here is
**title, start/end and cover**.

Found while building B207, which decided the four trip fields nothing could
write. Three of them — `people`, `rates`, `translations` — are now accepted by
`POST /api/v1/<user>/trips`, and that is the *only* moment
they can be set. `createTrip` (`lib/tripWrite.ts`) is the whole write surface
for a `trip.md`: there is no PATCH on `/api/v1/<user>/trips/<trip>` itself, and
the delete route is the only other thing that touches the folder.

So every one of these is now a thing an owner can ask for once and never
correct:

- a **title or tagline** typoed at creation;
- a **person** who came on the trip after it was created, or one who was named
  and should not have been — the same list that decides who may write to the
  trip;
- a **rate** typed in the ECB's direction rather than the trip's, which
  converts every cost in that currency wrongly and reports no error (B17);
- a trip that should now be **public**, or should stop being.

**`cover` is the one with no route at all.** B207 refused it on create with a
reason: at the moment a trip is made there is no `media/` folder, and
`POST /api/v1/<user>/trips/<trip>/media` refuses a batch that does not name a
day, so the first photograph cannot arrive until a day has. A cover can only
be chosen *after* the pictures are in, and there is nowhere to say so. The
skill tells a person to write the line by hand
(`.claude/skills/add-a-trip/SKILL.md`), which is advice with nowhere to go for
the owner B28 is about.

## Work

- Decide the shape first. A general `PATCH /api/v1/<user>/trips/<trip>` is the
  obvious answer and is not obviously the right one: `people` is write access,
  and widening it on a trip that already holds days is a different act from
  naming who was there on an empty one. Owner-only is the floor; whether
  `people` belongs on the same call as `title` is the question.
- Whatever it is goes on the REST door with the round trip asserted — the
  shape B175, B178 and B207 used.
- `cover` needs a path check the others do not: a value naming a file that is
  not in the trip's media should be refused rather than written, since a broken
  cover renders as a broken image on the trips index and in the OG card.
- Reuse `createTrip`'s validators rather than writing second copies. They
  already refuse rather than drop, which is the property that matters.

Not doing: an editing interface. There is none and there will not be one
(decision 24).

## Acceptance

- A trip created with a wrong `rates:` entry can be corrected without touching
  the file, through both doors, with a test that reads the corrected value back
  through `getTrip`.
- A cover can be set on a trip that has photographs, and a cover naming a file
  the trip does not have is refused.
- `people` is owner-only wherever it ends up, with a test that a trip-scoped
  token cannot change who may write to its trip.

## Triage, 2026-09-07

Confirmed against current code rather than trusting the ticket's own history:
`rates` (`PATCH .../trips/<trip>/rates`, `lib/api/tripRates.ts`), `visibility`
+ `listed` (`PATCH .../trips/<trip>/visibility`), `people`/`travellers`
(`PATCH .../trips/<trip>/people` and `.../travellers`, B524) and `costs`
(`.../costs`) all have their own doors already. `title`, `tagline`, `start`
and `end` also already have one — B622's `PATCH /api/v1/{user}/trips/{trip}`
(`lib/api/tripDetails.ts`, `patchTripDetails`), which this task's own Why had
not caught up with (it predates B622). Grepped every field B207 named as
create-only and found a door for all of them except one: **`cover` had no
write path anywhere** — `lib/tripWrite.ts:134` still said so explicitly, and
`PATCH /api/v1/{user}/trips/{trip}` refused it by name (*"The cover is still
trip.md alone"*). The narrowing the ticket already recorded twice was correct;
`cover` was the entire remaining scope.

## Resolution

Added `cover` to the same door B622 already built, rather than a new route —
`patchTripDetails` (`lib/api/tripDetails.ts`) now accepts a fifth field, and
`PATCH /api/v1/{user}/trips/{trip}` (`app/api/v1/[user]/trips/[trip]/route.ts`)
passes it through. Reused `createTrip`'s pattern of refusing rather than
dropping, as the Work section asked, but `cover` needed its own check that no
other field on that door does: a value naming a photo the trip does not have
would render as a broken image on the trips index and the OG card, so it is
checked against `getAllMedia(ref, AS_AUTHOR)` (`lib/entries.ts`) and refused
(`invalid_cover`, `400`) rather than written when it does not match a `src`
already in the trip's gallery. `AS_AUTHOR` rather than the closed default
because this is the owner's own call and a cover naming a photo still in a
draft day is a legitimate choice for them to make.

Storage detail worth recording: `cover:` on disk is trip-relative
(`/media/<trip>/…`), while `getTrip().cover`, `getAllMedia()[].src` and this
route's own request/response all use the owner-prefixed form
(`/<user>/media/<trip>/…`, via `mediaWithOwner`) — the same form a caller
reads back from `GET .../trips/{trip}` and `GET .../trips/{trip}/media`, so
the field is round-trippable by construction. `patchTripDetails` strips the
`/<user>` prefix back off before splicing the frontmatter line.

`null` or `""` clears the key, matching how `tagline` already behaves on the
same door. `PATCH` with only `cover` set is accepted (previously refused with
`nothing_to_change`, since the field did not exist) — one existing test in
`test/trip-details.test.ts` asserted the old refusal and was updated to name
a genuinely unwritable field (`accent`) instead.

**Contract**: `lib/api/openapi.ts` — the `PATCH /api/v1/{user}/trips/{trip}`
summary, description, request schema and `400` response now name `cover`;
`lib/api/errorCodes.ts` gained `invalid_cover`; `lib/api/agentCopy.ts` and
`lib/api/documentation.ts` (the `/agent.md` guide text) were updated so they
no longer say cover has nowhere to be set.

Tests: `test/trip-details.test.ts`, new `describe("the fifth field, cover")`
block — a real photo is accepted and read back (`cover` in the response, and
through `getTrip` after a cache clear), the trip-relative form on disk is
pinned byte-for-byte, a draft day's photo is accepted (`AS_AUTHOR`), a photo
the trip does not have is refused with `invalid_cover` and nothing is
written, and clearing removes the key rather than writing an empty one.

Not done: nothing — the ticket's own narrowing left exactly one field, and
it now has a door.
