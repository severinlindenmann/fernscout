---
id: B72
title: A trip whose dates have passed still calls itself upcoming, and hides every day written to it
type: ISSUE
priority: high
complexity: medium
area: trips, tripWrite, feed, search, ui
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
completed: "2026-09-03"
---

# B72 — A trip whose dates have passed still calls itself upcoming, and hides every day written to it

## Why

Found on 2026-09-01, walking an agent through creating a first journal on
fernscout.ch. The agent created a trip through the write API, wrote three days
into it, and published all three. Every day is reachable at its own URL and
renders correctly. The trip's own page says:

> **Testreise** — Montag, 24. August — Mittwoch, 26. August
> *Noch keine Tage — diese Reise steht noch bevor.*

The trip ran 24–26 August. It was read on 1 September. Nothing about it is
still ahead, and it has three days in it.

The field is `status`, and it is **declared and never checked**.

`createTrip` (`lib/tripWrite.ts:114`) defaults an unspecified status to
`upcoming`:

```ts
const status = STATUSES.includes(input.status as never) ? input.status! : "upcoming";
```

The MCP schema does document the default (`lib/mcp/tools.ts:885`), so an agent
that reads it carefully can set the field. This one did not, and the API took
dates six days in the past together with `status: upcoming` without a word.
Reading is the mirror image: `parseStatus` (`lib/trips.ts:145–148`) defaults a
*missing* status to `past`. Two defaults, opposite directions, and neither
consults `start` or `end`.

What one wrong word then does, none of it recoverable by writing more days:

- `app/[user]/trips/[trip]/page.tsx:68` branches on it before it ever loads
  days, and renders `TripCountdown` — a component whose closing line is a
  hardcoded `trips.noEntriesYet` (`components/TripCountdown.tsx:104`). It does
  not say "no days"; it *cannot* say anything else. The days exist and are not
  read.
- `lib/feed.ts:64` — `if (trip.status === "upcoming") continue; // nothing
  written yet`. The comment states the assumption exactly, and the assumption
  is false.
- `lib/search.ts:28` — the same line. The days are not searchable.
- `getCurrentTrip` (`lib/trips.ts:449–451`) picks `current`, else the most
  recent `past`. An upcoming trip is never either, so the journal reads as
  having no current trip at all — which is what sends `/gallery`, `/map` and
  `/costs` to a 404 (**B73**), and `/` to the trip list.
- `app/[user]/trips/[trip]/day/[slug]/page.tsx:22` drops upcoming trips from
  `generateStaticParams`, so the day pages are not prerendered. They still
  render on demand, which is why the direct links worked and made the trip page
  look like the only thing broken.

The cost is what the owner concludes. Three days were written and published,
correctly, and the site says the journey has not started. Nothing on the page
suggests a frontmatter field; the only visible remedy is to write the days
again.

## Work

Decide, and write down, whether `status` is **declared** or **derived**. The
present code is half of each, which is the bug.

Two candidate shapes, in preference order:

1. **Derive `past` and `upcoming` from the dates; keep `current` declared.**
   `current` is a real editorial choice — which trip the bare `/<user>` serves
   — and `getTrips` already arbitrates between rivals for it
   (`lib/trips.ts:403–407`). `past` and `upcoming` are not choices; they are
   facts about `start`, `end` and today. Deriving them in `readTrip` makes the
   frontmatter field a hint at most, and every consumer above correct with no
   change. Note that `isOver` (`lib/tripTime.ts:121–131`) already does this
   kind of reconciliation for a trip that ran past its own `end:` — the pattern
   exists, it is just not applied here.
2. **Keep it declared, and refuse to write a contradiction.** `createTrip` and
   the trip update path reject `upcoming` with an `end` in the past (and
   `past` with a `start` in the future), the way `lib/tripWrite.ts:122–128`
   already rejects `end` before `start`. Cheaper, but it only guards the front
   door: a trip that was honestly upcoming when created still rots into this
   state the day it ends, with nobody there to fix it.

Whichever is chosen, `TripCountdown` should stop being the only thing a
non-`past` trip can render: if days exist, show them. A component that says
"no days yet" while days sit unread on disk is wrong under any status scheme.

Not in scope: changing what `current` means, or `getCurrentTrip`'s fallback to
the most recent past trip. **B73** covers the 404s that follow from having no
current trip, and stands whether or not this task lands.

## Built

**Option 1, and the closing paragraph of it as well** — the two are belt and
braces rather than alternatives, and the second is the one that will still be
right under a status scheme nobody has thought of yet.

Every claim in *Why* was checked against the code before anything was changed
and every one of them held, line numbers included. Two things it did not say,
found on the way:

- `isOver` (`lib/tripTime.ts`) returns early on `status: "upcoming"`, so a
  stale `upcoming` was also enough to keep a finished trip from ever reading as
  over. Nothing visible followed from it here, but it is the same word doing
  the same damage a third time.
- `getTrips` caches parsed trips against a fingerprint of the trip files. A
  status derived from today's date and cached against a file's mtime would
  have gone stale at midnight and stayed stale until somebody edited a trip or
  restarted the server — the same "a change that needs a restart" the
  fingerprint exists to prevent. The date is now part of the fingerprint.

### The line is `start`, not `end`

`calendarStatus` (`lib/tripTime.ts`) answers `past` / `upcoming` from `start`
alone. Everything the two words decide is really "is there anything to read
yet?", and that flips on the day a trip begins.

The cost is a trip that is *under way* and not declared `current`: it reads as
`past`, which is the wrong word and the right bucket — `past` shows its days,
`upcoming` hides them. Deriving `current` for it would have been the third
option and is what *Not in scope* rules out, so the wrong word stands and the
days are readable. If it ever matters, it is a display question — the trips
index heading — not a data one.

### What changed

- `lib/tripTime.ts` — `calendarStatus(trip, now)` and
  `effectiveStatus(trip, now)`, next to `isOver`, which is the module that
  already reconciles a trip against the calendar. `current` passes through
  untouched.
- `lib/trips.ts` — `readTrip` runs the declared status through
  `effectiveStatus`; the loser of a two-`current` fight is re-derived rather
  than being set to `past` outright; `earliestTodayISO()` joins the cache
  fingerprint.
- `lib/tripWrite.ts` — the `upcoming` default is gone. An unstated status is
  taken from `start`, so a trip.md is not born contradicting its own dates. An
  explicit value is still written as asked; it is a hint, and reading overrules
  it.
- `lib/tripView.ts` — `showsCountdown(trip)`: `upcoming` **and** no published
  day. Drafts deliberately do not count, because a future-dated draft is how an
  upcoming trip's planned route is written (`lib/plan.ts`), and the countdown
  is the page that draws it. `app/[user]/trips/[trip]/page.tsx` calls it
  instead of testing `status` itself.
- `lib/feed.ts`, `lib/search.ts`, `app/sitemap.ts` — unchanged behaviour, but
  the comment that stated the false assumption ("nothing written yet") now says
  why the assumption is true.
- The write surfaces that documented the old default: `lib/mcp/tools.ts`,
  `app/openapi.json/route.ts`, `lib/api/documentation.ts` and
  `.claude/skills/add-a-trip/SKILL.md` now say that `past`/`upcoming` are
  derived and that `current` is the only value worth writing.

### Evidence

`test/trip-status.test.ts` reconstructs the incident: a trip.md dated
24–26 August 2026 carrying `status: upcoming`, one day written and published
through `createDraft` + `publishDraft`. Ten of its thirteen tests fail on the
code as it was.

The live check ran `next dev` against a copy of the example journal with that
trip added, `/example/trips/testreise`, before and after:

- before — 0 occurrences of the day's title, and the page's closing line is
  `No days written yet — this one hasn't happened.`
- after — the day renders; no countdown.

### Found, not fixed

The countdown branch builds `basemapFor(frameRoute(plan.stops))` before it
knows whether there are any stops, and `frameRoute([])` is `WHOLE_WORLD`
(`lib/mapFrame.ts:147`). A trip with no `plan.md` therefore serialises a
whole-world basemap into a page that never draws a map: the before-state
response above was **17.5 MB**, against 78 KB for the same trip's story page.
Unrelated to status, and still reachable by any genuinely upcoming trip that
has no planned route yet.

## Acceptance

- A trip created through the API or MCP with `start`/`end` in the past, and no
  `status` given, does not render a countdown. Its days are on its trip page.
- A test that creates a trip with `end` before today and `status: upcoming` in
  the frontmatter, writes one published day, and asserts that day appears in
  the trip page's props, in `lib/feed.ts`'s items, and in the search index.
- `npx vitest run` green, and the four checks in AGENTS.md.
