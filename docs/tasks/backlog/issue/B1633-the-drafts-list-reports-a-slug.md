---
id: B1633
title: "The drafts list reports a slug the v2 day route cannot address"
type: ISSUE
priority: high
complexity: low
area: API v2
found: 2026-09-13T00:00:00Z
---

## Why

`GET /api/v2/{user}/status` answers, live on fernscout.ch today:

```json
"drafts": [{ "trip": "japan-2027", "slug": "matsumoto-detour",
             "title": "The Matsumoto detour" }]
```

That slug is the **bare** form. v2 addresses a day by its whole filename
stem — `2027-04-14-matsumoto-detour` — so an agent doing the obvious thing
with the answer it was just given:

```
GET /api/v2/example/trips/japan-2027/days/matsumoto-detour   → 404
```

The drafts list is *the* place an agent looks to find what is waiting for a
person to read back. Handing it an identifier that its own API will not
accept makes the whole review queue unusable without a second, undocumented
step (re-deriving the stem from the day's `date`).

This is **B1618's cousin** — the same slug-convention split, surfacing
somewhere else. B1618 was v2 routes passing the full stem to v1 functions
that wanted the bare form; this is a v1 function handing the bare form to a
v2 document that wants the stem. The conversion lives in one place
(`v1Slug`, `lib/api/v2/days.ts`) and needs its mirror.

**It is latent, not visible, right now** only because the v2 trip routes read
`trip.json` and the live content is still markdown (B1598), so the day route
404s for every day regardless. It becomes visible the moment B1598 lands,
which is why it should be fixed before that merge rather than after.

## Work

`buildJournalStatus` (`lib/api/v2/status.ts`) reads `listDrafts`
(`lib/api/entries.ts`), which returns v1's `Entry.slug` — bare, because
`entrySlugFromFile` strips the date prefix. Convert to the stem at the v2
boundary, the mirror of `v1Slug`:

- add the inverse beside `v1Slug` in `lib/api/v2/days.ts` — it needs the
  day's `date`, which `listDrafts` already has;
- use it in `buildJournalStatus` so every `drafts[].slug` is addressable;
- assert it end to end: take a slug out of `/status` and `GET` that day
  through the v2 route in the same test. A test that only checks the shape
  would have passed today.

Check the same mismatch elsewhere while in there — anywhere a v2 document
reports a slug that came from a v1 reader. `daySummary` is the obvious
candidate.

Not doing: changing `entrySlugFromFile`. The bare form is v1's convention
and v1's readers still depend on it; the conversion belongs at the boundary,
which is where `v1Slug` already puts its half.

## Acceptance

- A slug from `GET /api/v2/{user}/status`'s `drafts` can be passed straight
  to `GET /api/v2/{user}/trips/{trip}/days/{slug}` and finds the day.
- A test does exactly that round trip rather than asserting a shape.
- `?days=summaries` reports the same addressable form.
