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

Hiding an entry is not hiding that it existed, and this codebase is built to
tell you. A full sweep of every path that reads a day found five places where a
filter on `visible()` alone would not be enough, and one of them is the whole
design problem:

**`buildStoryProps` always sends every day.** `lib/tripView.ts:157` builds
`index` from *all* days — date, slug, location, country, coordinates, transport,
cost per day — and returns it in full while only `days.slice(from, to)` carries
prose. Every story render, on the home page and both day permalinks, ships the
complete day index to the browser. Filtering the prose and not this publishes a
lossy copy of the withheld day: its title (via the slug), where it was, and what
it cost.

**Costs cannot be told who is asking.** `getAllCosts` at `lib/costs.ts:105`
calls `getAllEntries(tripId)` with **no `ReadOptions` argument at all** — the
function has no parameter for it. So `getCostSummary`, `byDay`, `byCategory`,
`byCountry` and the budget pace curve are sums over every published entry, and
a withheld day's spend stays in the trip total. Signature change, not a filter.

**Reactions are keyed by day slug.** `app/api/reactions/route.ts:103` returns
`getAllCounts` for the whole trip, and the route's own comment records that this
exact mechanism has leaked day titles once already at trip level. Its `POST`
uses the same trip gate deliberately — "writing a row against a day is how the
day's slug got published in the first place" — so both halves need the per-day
check, or a prober confirms a hidden day by voting on it.

**`export.zip` filters drafts and nothing else.** `isDraftEntry` at
`lib/exportZip.ts:74` is the only per-file rule the `open-to-link` scope
applies, so an anonymous export of a public trip would hand over the withheld
day's markdown and its media.

**The landing page picks the first photograph it can find.** `coverFor` at
`app/page.tsx:51` walks `getAllEntries` across every indexable trip and returns
the first image — which could be the withheld day's, as the instance's public
teaser card.

Smaller, same shape: `getPlaces`/`getTripStats` (`lib/entries.ts:291`, `:339`)
fold every day into place, night, country and media counts; `lib/plan.ts:75`
marks a planned stop "reached" from `getPlaces`, so a hidden day still moves a
pin on the map for everyone; `basemapForRoute` frames the map tile on those same
coordinates; the day pager and "day 14 of 22" make a gap legible;
`generateStaticParams` (`app/[user]/(trip)/day/[slug]/page.tsx:17`) prerenders a
route per entry; and `generateMetadata` on the day pages puts a per-day photo
into `openGraph.images` under the trip gate only.

Whether a hidden day should be *invisible* or *visibly withheld* ("this day is
for friends — sign in") is the real design question, and the answer differs by
audience. Deciding it is what the plan is for; B117 is the precedent for the
reasoning — a closed trip's gate deliberately does not name the trip.

Two existing precedents to build on rather than invent past:
`isTestContent(trip, entry?)` (`lib/access.ts:67`) and
`subscribersFor(trip, entry?)` (`lib/push.ts:132`) are already trip-level
functions taking an optional entry, which is the shape a `mayReadEntry` beside
`mayReadTrip` would take.

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
- **Existence.** What the pager, the counter, the map, the costs, the
  gallery, the reaction counts and the landing-page cover say about a day that
  is there and not for you. `lib/tripView.ts:157` and `lib/costs.ts:105` are
  the two that need signatures changed rather than a filter added.
- **Writing it.** `EntryInput` (`lib/validate/entry.ts:58`) validates no
  `status` and no visibility today — the draft flag is written by `createDraft`
  in `lib/api/entries.ts:218`, not by validation. So the field needs a
  `checkVisibility` there plus wiring through `createDraft`, `POST .../days`
  and `lib/mcp/tools.ts`, or it is unreachable — which is exactly B178.
- **`/agent.md` and `/documentation.txt`** have to describe it, and `AGENTS.md`
  and the ROADMAP visibility decisions (11, 12) need the amendment.

Explicitly **not** in scope: per-*photograph* visibility inside a day (the route
comment offers it; the ask is per-day), and any narrower audience than "guests
of this journal" — no per-person allow-lists on an entry.

## Acceptance

- A day in a `public` trip marked `visibility: guest` is absent, for a signed-out
  reader, from: the trip page, `/day/<slug>` (404, not 403), the markdown twin
  `/<user>/day/<slug>.md`, `feed.xml`, `sitemap.xml`, `search-index.json`,
  `story.json` — **including its `index` array** — `export.zip`, the reaction
  counts, and every media URL under that day's slug.
- Its spend is absent from the trip total, `byDay`, `byCategory`, `byCountry`
  and the pace curve; its coordinates do not move a planned stop to "reached",
  do not frame the basemap, and its photograph is not the landing page's cover.
- `POST /api/reactions` against that day's slug refuses, so the slug cannot be
  confirmed by voting on it.
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
