---
id: B236
title: One entry file that does not parse throws out of getAllEntries, so the whole trip stops reading rather than that one day
type: ISSUE
priority: medium
complexity: low
area: entries, reading
found: "2026-09-04T08:04:38Z"
---

# B236 — One entry file that does not parse throws out of getAllEntries, so the whole trip stops reading rather than that one day

## Why

Found while building B208, and measured rather than assumed. B208 says the
consequence of an entry that does not parse is that the day is "invisible at
every reading path". It is worse than that, and B208's Why has been corrected
to say so and to point here.

`readAllEntries` (`lib/entries.ts:148`) maps every `.md` in the trip's
`entries/` through `matter(raw)` with no guard. gray-matter throws on invalid
YAML, so **one bad file takes the whole trip with it**: `getAllEntries`,
`getDays`, `getEntryBySlug`, `getPlaces`, `getTripStats` and everything built
on them — the trip page, the feed, the sitemap, the search index — all raise
instead of returning what they can.

Observed directly, on a trip holding one good entry and one whose title quote
is unterminated:

```
getAllEntries("alex/asia-2026")
→ THREW: unexpected end of the stream within a double quoted scalar at line 3, column 1
```

The good entry is not returned. B208 closed the one door that could write such
a file through the API, so what is left is a person editing a file by hand,
which is the supported way to use this software — and the failure they get is
a trip that has disappeared rather than a day that has.

`getTrips`/`getTrip` have the equivalent guard for malformed `trip.md` already
(see `test/malformed-trips.test.ts`), so the pattern to follow is in the
codebase.

## Work

- Decide what one unreadable entry should do. Skipping it and logging is what
  the trip loader does for a malformed `trip.md`; the trip goes on reading and
  the operator has something to find.
- Whatever it does, a reader of the *other* days must not be punished for it.
- Consider whether the owner's own view should say the file is there and
  unreadable, rather than the day silently not existing — a day that vanishes
  with no message is how somebody loses writing without noticing.
- Check the same shape in `listDrafts` and `isPublished`
  (`lib/api/entries.ts`), which call `matter` per file with no guard either.

## Acceptance

- A trip holding one unparseable entry still serves its other days.
- A test writes a broken entry beside a good one and asserts the good one is
  read.
