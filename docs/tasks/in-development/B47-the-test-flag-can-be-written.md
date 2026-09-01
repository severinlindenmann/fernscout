---
id: B47
title: The test flag can be written but never read back, so nothing can confirm it stuck
type: ISSUE
priority: high
complexity: low
area: api, trips, test-flag
found: "2026-09-01"
started: "2026-09-01"
---

# B47 — The test flag can be written but never read back, so nothing can confirm it stuck

## Why

Reported by an agent that had just used it:

> The test flag doesn't come back on reads. I set it at creation, and
> `GET /trips` doesn't echo it — nor does the full day read. So I can't verify
> from the API that the banner is actually there.

Verified against production. `tripSummary` in `lib/api/entries.ts:286` returns
`id, ref, title, tagline, start, end, status, visibility, days, entries,
drafts` — and no `test`. That one function backs both `GET /api/v1/{user}/trips`
and the reply to `POST .../trips`, so **an agent that sets `test: true` on a
trip is never told it was accepted, and can never see it afterwards.**

The day read is a half-exception and the shape of it matters. `GET
.../days/{slug}` does return `test` — but only when the *entry* carries it. The
flag is designed to be inherited from the trip, which is the way an agent
setting up a whole test journey will naturally use it, and in that case the day
read is silent too. So the agent's report is exactly right for the way it
actually used the feature.

Why this matters more than an ordinary missing field: `test: true` is a
**safety flag**. It is the difference between a page that says "none of this
happened" and a page that reads as somebody's Tuesday. An agent that cannot
confirm it stuck has to either trust that it did or tell the person to go and
look — and the agent that reported this correctly refused to assume, which is
the behaviour we want and should not have to cost anybody a browser check.

`test/test-banner.test.tsx` now proves the banner renders, so the flag does
work. This task is about the API being able to say so.

## The worst instance: the markdown twin (found 2026-09-01, raises this to high)

A `test: true` day was published to production and its twin fetched:

```
GET https://fernscout.ch/alpenweg/trips/testreise-2026/day/erster-tag.md

---
title: "Erster Tag"
date: "2026-09-01"
time: "09:15"
location: "Bellinzona"
country: "Switzerland"
lat: 46.1944
lng: 9.0175
photos: 1
---

Ankunft am Morgen. Erfundener Testinhalt.
```

**Nothing says this day did not happen.** The HTML page carries the banner; the
twin — which is unauthenticated, public, and exists *specifically so that
agents read it instead of the page* — is silent.

That inverts the whole point of the flag. It was added so an operator could
exercise the pipeline without writing prose that only looks harmless because an
agent chose to make it so; and the surface built for machine readers is the one
that drops the warning. An agent summarising somebody's journal, or an ingest
that walks `documentation.txt` into a twin, reads invented content as record.
`lib/api/markdownTwin.ts` builds the frontmatter field by field, so the flag is
simply not among the fields it emits.

This is why the priority is high rather than medium. The trips-list and day-read
gaps cost an agent a verification step. This one hands out fiction with no
label, to exactly the audience least able to tell.

## Work

- Add `test` to `tripSummary`, which fixes the trip list and the creation reply
  together. Echo it only when true, matching how the day read already does it —
  a `"test": false` on every ordinary trip makes the field look routine.
- On the day read, report the flag the *page* will act on, not just the
  entry's own: a day in a test trip gets the banner, so the read should say so.
  `isTestContent(trip, entry)` in `lib/access.ts` is already that predicate.
  Distinguish inherited from set-on-the-day if it is cheap; if not, the
  effective value is the one that matters.
- Same for MCP's `list_trips`, which shares the summary.
- **The markdown twin emits it**, as a frontmatter field on a test day —
  `lib/api/markdownTwin.ts` builds that block field by field and simply omits
  it. A line of prose above the body would be stronger still: an agent that
  reads only the text gets the warning either way, and the file is markdown for
  people as much as for parsers.
- One line in `agent.md` under the test flag: reading a day back is how you
  confirm it, and a twin says so too.

## Acceptance

- `POST .../trips` with `"test": true` answers with `test: true` in the trip it
  echoes back.
- `GET /api/v1/{user}/trips` shows it for that trip and omits it for others.
- `GET .../days/{slug}` reports the flag for a day in a test trip, whether or
  not the entry sets it itself.
- **`GET /<user>/trips/<trip>/day/<slug>.md` for a test day says so**, before
  the prose, without a token. A test asserts it against the real twin output.
- A test asserts the round trip — set it, read it back — because the whole
  complaint is that writing and reading disagreed.
