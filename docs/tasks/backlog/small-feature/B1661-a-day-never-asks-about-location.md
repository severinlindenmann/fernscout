---
id: B1661
title: A day never asks about location/country/countryCode/timezone or translations before it exists
type: FEATURE
priority: low
complexity: medium
area: Helper / API v2
found: "2026-09-13T10:36:58Z"
---

# B1661 — A day never asks about location/country/countryCode/timezone or translations before it exists

## Why

B1650 (decision a) taught the helper to ask about four of v2's `DAY_DECLINABLES`
(`time`, `transportMode`, `tags`, `visibility`) before a day is created, via
the existing `missingFrom` refusal loop (`lib/tracks.ts`). It deliberately left
two more out, and this is the ticket that captures them rather than losing the
finding:

- `location`, `country`, `countryCode` and `timezone` are each their own row
  in `DAY_DECLINABLES` (`lib/api/v2/schemas/day.ts`), but nothing in the
  helper independently asks about them — they are filled automatically from
  `coordinates` via `reversePlace`/`timezoneForCoordinates`
  (`app/api/helper/[user]/day/route.ts`) when a coordinate exists, and simply
  absent otherwise. A day whose coordinates are declined, or whose reverse
  lookup fails (capability off, or an address the geocoder cannot resolve),
  is left with these four genuinely unanswered — no decline is ever recorded
  for them, so a v2-strict read would find the day incomplete on fields
  nobody was ever asked about or told the day lacks.
- `translations` is a `DAY_DECLINABLES` row too, but the helper has no tool
  that writes a day's title/content in a journal's other declared languages
  at all — the only way to answer it today is an agent driving
  `PATCH /api/v2/…` directly with a hand-written `translations` map. A
  single-locale journal (the common case) is arguably exempt in spirit — the
  question has no honest answer to give — but `lib/tracks.ts` is deliberately
  pure (no journal, no fs) and cannot know the journal's locale count, so this
  needs a check at the call site rather than a fifth Track row.

## Work

- Decide, and record the decision: when coordinates exist but the reverse
  lookup produced nothing, should `location`/`country`/`countryCode`/
  `timezone` be auto-declined with a reason describing that objective fact
  (capability off, or lookup returned nothing) — analogous to how a decline
  already covers "nobody was asked" elsewhere — or does a person need to be
  asked directly? When coordinates are themselves declined, the four almost
  certainly cascade from that same decline rather than needing their own.
- Build whichever mechanism follows from that decision, wired through the
  same create-time gate B1650 added.
- For `translations`: read `getUser(username)?.locales` at the call site
  (not inside `lib/tracks.ts`) to decide whether the question exists at all
  for this journal; if it does, decide whether the helper needs a real tool
  for writing translated content or whether decline-only is acceptable until
  one exists.

## Acceptance

A day created through the helper carries an answer (real or declined) for
`location`/`country`/`countryCode`/`timezone`/`translations` in every case
`dayWrite`'s schema would otherwise call incomplete, or the ticket records why
a particular case is intentionally left open.
