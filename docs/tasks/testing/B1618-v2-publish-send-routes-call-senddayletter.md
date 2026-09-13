---
id: B1618
title: v2 publish/send routes call sendDayLetter/sendDayWhatsapp with the wrong slug shape, so a requested send always answers unknown_day
type: ISSUE
priority: high
complexity: medium
area: API v2
found: "2026-09-12T20:19:51Z"
merged: "2026-09-12T21:33:18Z"
---

# B1618 — v2 publish/send routes call sendDayLetter/sendDayWhatsapp with the wrong slug shape, so a requested send always answers unknown_day

## Why

`app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route.ts` and its sibling
`.../send/route.ts` call `sendDayLetter(user, ref, slug)` /
`sendDayWhatsapp(...)` / `whatsappWouldCost(...)` with `slug` taken straight
from the URL param — the whole `YYYY-MM-DD-slug` filename stem v2 addresses a
day by (`daySlug` in `lib/api/v2/schemas/day.ts`). Those three functions are
v1's own (`lib/digest/dayLetter.ts`, `lib/digest/dayWhatsapp.ts`) and read a
day by the BARE slug — `entrySlugFromFile` in `lib/entries.ts` strips the
date prefix before matching. So every send requested through either v2 route
reads back `{ok:false, reason:"unknown_day"}` (or `unknown_trip`), no matter
how complete the day is on disk, unless a day's slug happens to contain no
date-shaped prefix by coincidence.

`whatsappWouldCost`'s own `.catch(() => 1)` fallback hides the symptom in the
credits pre-flight: instead of pricing the real recipient count it silently
prices "1", so a publish that should be refused for insufficient credits
sails through with `200`, and a publish that should succeed can be wrongly
priced too.

Found while repointing `test/day-mail.test.ts` from the deleted v1
`.../publish`/`.../send-mail` routes onto v2's `.../publish`/`.../send` for
B1612. Six of that file's tests (the ones that request an actual send) are
left failing and documented rather than bent to pass — the property itself
(the letter is sent, to the right people, with the right content) is proven
separately, directly against `sendDayLetter`, with no route in the way, in
the same file's earlier describe blocks.

This is a DIFFERENT gap from the one B1598's own comment already names in
these two routes (a v2-native trip/day being invisible to the v1 reader at
all, because it has no `trip.md`/`entries/*.md`) — that gap is about the
STORAGE format; this one is about the SLUG the routes pass across that
boundary, and would still bite even once B1598's storage bridge exists,
because the two vocabularies (whole-filename slug vs bare slug) disagree
regardless of which format is actually on disk.

## Work

- In both routes, resolve the bare v1 slug from the v2 slug before calling
  `sendDayLetter`/`sendDayWhatsapp`/`whatsappWouldCost` — the v2 slug's own
  `YYYY-MM-DD-` prefix is the day's `date` field, already on the stored
  `DayFile`, so the bare slug is `slug.slice(11)` off the v2 slug the route
  already has, not a second lookup.
- Or, if B1598's storage-bridge work lands first and these three functions
  grow a v2-native reader, confirm the slug convention they expect matches
  what the routes pass — do not assume fixing B1598 alone fixes this.
- Re-run `test/day-mail.test.ts`'s six failing tests (see the file's own
  `KNOWN GAP` comment above the "the two triggers" describe block) once
  fixed; they were written to assert the real, intended behaviour and should
  go green without further changes.

## Acceptance

- `POST /api/v2/{user}/trips/{trip}/days/{slug}/publish` with `sendMail:
  true` (or `.../send` with `channels: ["mail"]`) on a real, complete,
  published day actually writes a `.eml` file, and the response's
  `mail.attempted` is `true`.
- The six tests named in `test/day-mail.test.ts`'s `KNOWN GAP` comment (in
  the "the two triggers" describe block) pass unmodified.
