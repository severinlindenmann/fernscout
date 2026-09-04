---
id: B245
title: A trip's trip.md cannot be changed after the trip is created
type: ISSUE
priority: medium
complexity: medium
area: trips, api
found: "2026-09-04T09:04:59Z"
---

# B245 — A trip's trip.md cannot be changed after the trip is created

## Why

> **Stale reference, 2026-09-04.** B298 removed MCP: there is no `lib/mcp/`
> and no `/api/mcp`. Every mention of an MCP tool or endpoint below describes
> deleted code, and "the network door" now means the REST API alone. The
> reasoning is unchanged — the paths it names are one fewer than it says.

Found while building B207, which decided the four trip fields nothing could
write. Three of them — `people`, `rates`, `translations` — are now accepted by
`POST /api/v1/<user>/trips` and by `create_trip`, and that is the *only* moment
they can be set. `createTrip` (`lib/tripWrite.ts`) is the whole write surface
for a `trip.md`: there is no PATCH on `/api/v1/<user>/trips/<trip>`, no
`update_trip` tool, and the delete route is the only other thing that touches
the folder.

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
- Whatever it is goes on **both** doors, REST and MCP, with the round trip
  asserted — the shape B175, B178 and B207 used.
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
