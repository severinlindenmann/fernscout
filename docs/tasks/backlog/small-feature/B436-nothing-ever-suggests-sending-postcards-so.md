---
id: B436
title: Nothing ever suggests sending postcards, so nobody discovers the feature
type: FEATURE
priority: medium
complexity: low
area: postcards, agent guide
found: "2026-09-05T10:12:31Z"
---

# B436 — Nothing ever suggests sending postcards, so nobody discovers the feature

## Why

Once B434 lands, ordering a postcard is three calls an agent has to know exist.
`GET /api/v1/<user>/status` already exists to tell an agent where it stands —
drafts waiting, trips, capabilities — and says nothing about this. An owner who
never reads `/agent.md` never learns of it at all.

The moment worth catching is narrow and knowable: a day has just been published,
it has a photograph, and somebody in the contacts list asked for a real card. It
should be the site that notices, not the person.

## Work

- `GET /api/v1/<user>/status` gains `suggestions: [{kind, day, trip, reason,
  recipients}]`. One computing function in `lib/postcard/suggest.ts`, offered
  when **all** of these hold:
  - `postcards`, `credits` and `contacts` are enabled for this journal;
  - at least one `active` contact ticked the postcard box and has an address;
  - a published, non-`test` day in the last few days has a usable photo;
  - no order was sent for that trip in the last seven days.
- The same function renders a card on `/<user>/me` — one fact, two doors, so
  the two can never disagree.
- A paragraph in `/agent.md` and a line in the `send-postcards` skill.

**Not doing:** mail or push about it. An unasked-for suggestion that arrives in
somebody's inbox is an advertisement.

## Acceptance

- `status` carries no `suggestions` key at all when any of the four conditions
  fails — absent, not an empty array with an explanation.
- A journal with credits off never sees the suggestion, on either door.
- A `test: true` day never produces one.
- The `/me` card and the `status` field come from one call, asserted by a test
  that changes one condition and checks both change.
