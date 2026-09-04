---
id: B275
title: A day cannot be held back from a public trip, so one private afternoon makes the whole trip guests-only
type: FEATURE
priority: medium
complexity: high
area: access, entries, media, feed, search
found: "2026-09-04T12:20:00Z"
---

# B275 — A day cannot be held back from a public trip, so one private afternoon makes the whole trip guests-only

## Why

Visibility is decided per **trip** and nowhere else. `TripVisibility` in
`lib/types.ts:201` is `private | public | guest`, it is read from `trip.md`, and
`mayReadTrip` in `lib/tripGate.ts` is what every reading path asks. An `Entry`
(`lib/types.ts:52`) has no visibility field at all — the only per-entry gates it
carries are `draft?` and `test?`.

So the choice an author actually has, when one day of an otherwise public trip
should be for friends only, is between publishing it to everybody and closing
the entire trip. Both are wrong, and the second is worse than it sounds: a trip
turned `guest` disappears from the sitemap, the feed and the switcher for
everyone who was reading it, to hide one afternoon.

The ask here is per-day: **the journal stays public, and a named day is
`guest`** — readable by the people the owner has approved into the journal, and
by the people on the trip. Pictures included, which is the half that matters.

`AGENTS.md:133` currently states the opposite as a design position: "A trip that
must be held back from people who are otherwise let in is `private`, and that is
the only mechanism; **there is deliberately no narrower one.**" That sentence is
about trips inside a journal, and this task makes it untrue. It is a smaller
reversal than B262's, but it is one, and the line has to be rewritten rather
than left to contradict the code.

### The good news: both chokepoints already exist

This is not twenty call sites needing a new filter, and the reason is `draft`.

**Text.** `visible()` at `lib/entries.ts:100` is a per-entry filter that every
reading path already goes through — `getAllEntries` is the only door, which the
comment at `lib/entries.ts:229` says in as many words, and `getDays`,
`getEntryBySlug`, `getDefaultDay`, `getPlaces`, `getAllMedia` and
`getTripStats` are all built on it. `ReadOptions` (`lib/entries.ts:97`) is the
seam: one option, threaded as an argument rather than held as request state,
precisely so that concurrency cannot leak one reader's answer to another. 35
files call these readers; none of them filters entries itself.

**Media.** `app/[user]/media/[...path]/route.ts:10` predicted this feature:
"Serving it through a route rather than copying it back into `public/` at build
time is also what makes per-trip and **per-photo visibility possible later**:
this is the single place a permission check will go." And it already does the
per-entry version of the check — `isDraftDay` at line 26 resolves
`segments[1]` as a day slug and refuses a draft day's photographs to anyone but
the owner. Media is keyed by day slug on disk, so the same lookup answers the
visibility question.

### The one thing that must not be got wrong

`visible()` with no options **drops** drafts. A path that forgets to pass the
option therefore fails closed, which is why the draft rule has held. Entry
visibility has to keep that polarity: absent viewer means public-only, never
"show everything". Get it backwards and a forgotten argument publishes
somebody's private day, silently, on a page nobody thought was involved.

### What still leaks after the content is hidden

Hiding an entry is not hiding that it existed, and the trip pages are built to
tell you:

- **The day pager and the day counter.** `/day/<slug>` has next/previous and
  "day 14 of 22"; a gap is a statement.
- **The aggregates.** `getTripStats`, `getPlaces`, `lib/costs.ts`,
  `lib/basemap.ts` and `lib/mapFrame.ts` fold entries into counts, a route line
  and a spend total. A route that visibly detours through a town whose day is
  missing has published the location, if not the words.
- **The gallery.** `getAllMedia` is entry-derived, so it follows the filter,
  but the count beside it may not.

Whether a hidden day should be *invisible* or *visibly withheld* ("this day is
for friends — sign in") is the real design question, and it is a different
answer for the two audiences. Deciding it is what the plan is for; B117 is the
precedent for the reasoning — a closed trip's gate deliberately does not name
the trip.

Related: **B43** wants the digest to mail a day's content to guests, so it
inherits whatever this decides about who may read a day; **B178** is the same
shape one level up (a per-trip `costsVisibility` nothing can write).

## Work

A plan in `docs/plans/` first, because the leaks above are decisions rather than
code, and this task points at it. What it has to settle:

- **The field and its vocabulary.** Reuse `TripVisibility` on the entry rather
  than inventing a second set of words, and decide how it composes with the
  trip's: an entry can only ever be *narrower*, the way `listed:` may only
  narrow `visibility:` (B51). A `public` entry on a `private` trip is a typo,
  and must read as `private` and be logged, never obeyed.
- **`ReadOptions` becomes a viewer** rather than one boolean, and `visible()`
  is the only thing that reads it. Restrictive by default, as above.
- **The media route** gains the visibility check beside `isDraftDay`.
- **Existence.** What the pager, the counter, the map, the costs and the
  gallery say about a day that is there and not for you.
- **Writing it.** The REST and MCP write paths need to be able to set it —
  `POST .../days` and `lib/mcp/tools.ts` — or the field is unreachable, which
  is exactly B178.
- **`/agent.md` and `/documentation.txt`** have to describe it, and `AGENTS.md`
  and the ROADMAP visibility decisions (11, 12) need the amendment.

Explicitly **not** in scope: per-*photograph* visibility inside a day (the route
comment offers it; the ask is per-day), and any narrower audience than "guests
of this journal" — no per-person allow-lists on an entry.

## Acceptance

- A day in a `public` trip marked `visibility: guest` is absent, for a signed-out
  reader, from: the trip page, `/day/<slug>` (404, not 403), the markdown twin
  `/<user>/day/<slug>.md`, `feed.xml`, `sitemap.xml`, `search-index.json`,
  `story.json`, `export.zip`, and every media URL under that day's slug.
- The same day is readable, in all of the above, by an approved guest of the
  journal and by a person listed on the trip.
- The rest of the trip is unchanged for everybody: still public, still listed,
  still in the feed.
- A test asserts that calling `getAllEntries` with **no** viewer drops a
  `guest` entry — the fail-closed property, stated as a test so a later
  refactor cannot quietly invert it.
- A test asserts `visibility: public` on an entry of a `private` trip does not
  widen it, and is logged.
- `visibility` is settable through the REST API and MCP, and appears in
  `openapi.json`.
- `npm run build && npx tsc --noEmit && npx eslint . && npx vitest run` pass,
  and `claude-security` has been run over the branch with each finding either
  fixed or captured by id.
