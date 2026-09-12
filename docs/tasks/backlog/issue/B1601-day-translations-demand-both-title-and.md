---
id: B1601
title: "Day translations demand both title and content; nine real days translate only the body"
type: ISSUE
priority: high
complexity: low
area: API v2
found: 2026-09-12T00:00:00Z
---

## Why

A dry run of `content/example` through the frozen v2 schemas (B1596) refused
nine of forty-four days:

```
day usa-2026/utah-red-country [translations.de.title]: expected string, received undefined
day asia-2023/mekong-slow-boat [translations.hu.title]: expected string, received undefined
```

v1's `EntryTranslations` has both `title` and `content` optional, and the
content uses that: `content/example/trips/usa-2026/entries/2026-06-19-utah-red-country.md`
carries a German `content:` and no `title:` — the prose translated, the title
left in the original. v2's `translations`
(`lib/api/v2/schemas/day.ts`) requires both.

**The contract is right and the content is what is incomplete.** The obvious
first reading — loosen the schema back to v1's shape — is the drift this
migration exists to avoid. An absent title and a title that is deliberately
identical are *different claims*, and only one of them is recoverable a year
later. A day whose title reads the same in German says so by carrying that
same string in the German block: `title: "Utah Red Country"` under `de` is
the true statement *"in German this day is called Utah Red Country"*, which
is exactly what a translator who left the title alone decided. Nothing is
invented by writing it down.

## Work

- **No schema change.** `lib/api/v2/schemas/day.ts` and `trip.ts` stay as
  they are.
- Add a test to `test/api-v2-schemas.test.ts` asserting the refusal, with a
  comment carrying the reasoning above — so the next agent looking at nine
  refused days does not reach for the same wrong fix.
- The nine days get a complete `translations` block when `content/example` is
  replayed (phase 3). Each German and Hungarian block carries a `title`: the
  real translation where one exists, the original string where the title
  reads the same in that language. This is demo content authored for the
  purpose, so writing a real German title is legitimate — it is not somebody
  else's memory being invented.

The nine days: `usa-2026/2026-06-19-utah-red-country`, plus eight more the
dry-run script names — re-run it to list them
(`scratchpad/dryrun/replay.mts`) rather than transcribing a list here.

## Acceptance

- `dayWrite.safeParse` accepts every day in `content/example` after the
  replay, with no schema change in the diff.
- A day translation missing `title` is refused, and a test says so.
