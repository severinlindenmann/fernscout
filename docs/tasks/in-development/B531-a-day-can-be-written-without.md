---
id: B531
title: A day can be written without everything the trip is keeping, and nothing says so
type: FEATURE
priority: high
complexity: high
area: api, days, trips, validation
found: "2026-09-06T09:55:00Z"
started: "2026-09-06T07:53:28Z"
session: 5813be44-d8aa-40f5-ab31-affc7af3746a
claimed: "2026-09-06T07:53:28Z"
---

# B531 — A day can be written without everything the trip is keeping, and nothing says so

## Why

An agent moved a finished ten-day trip onto a hosted instance — 14 days, 75
photographs, a budget — and every call answered `200`. The owner then opened
the costs page and found no per-day spending, and no day showing what it cost.

Nothing had failed. The agent had listed the entries on disk through a filter
of its own (title, date, place, coordinates), seen no `costs:` in its own
output, concluded there were none, and written 14 days without them. 22 cost
lines across 7 days never left the laptop.

The mistake was ordinary. What made it expensive is that **nothing in the
system disagreed with it**: a day is accepted with whatever it happens to
carry, so an omission and a deliberate blank are the same request, and a trip
that is keeping track of something has no way to say so.

**One field already works the way this needs to.** A journal declares its
`locales`, and `checkTranslations` (`lib/validate/entry.ts:366`) refuses a day
that does not carry them — naming the languages owed and the two ways out.
Nobody has to remember `translations`. Money, coordinates and photographs are
remembered by nobody.

Full reasoning, and what this deliberately is not, in
`docs/plans/W40-what-a-day-owes.md`.

## Work

**The registry.** One module listing what a trip may keep — `costs`,
`location`, `photos`, and the `weather` row the feature being built alongside
this will add. Each row knows how to see whether a day satisfies it, what to
say when it does not, and where it is checked. Hard-coding the set is what
makes the next one a five-file change.

**`tracks:` on the trip.** A block in `trip.md`, absent meaning **every row
on** — the default an owner never has to find. Written by `POST .../trips` and
correctable at `PATCH .../trips/<id>/tracks`, the same one-field door
`.../rates`, `.../visibility`, `.../people` and `.../travellers` already have.

**The refusal.** `POST .../days` answers `422 incomplete_day` when the day is
missing something the trip tracks, with one entry per field carrying `why`,
`send` and `decline`. `PATCH` runs it against the day as it would be after the
edit, not against the patch.

**The decline.** `"costs": false` in the body means *there was no money on
this day* — a fact about the day, written to frontmatter as `without: [costs]`
so a reader a year later can still tell it from nobody having asked. It is not
a validation bypass and must not be described as one; every refusal names it
as an equal answer, and no refusal ever suggests inventing a value.

**Publish is the second gate.** Photographs cannot arrive on `POST` — media is
a second call — so `photos` is checked at `POST .../publish`, which re-runs the
whole contract. A day written before its trip started tracking something is
then caught on the way to the site rather than never.

**Say it before it is hit.** The tracked list belongs in the trip create
response, in `GET .../trips`, in `GET .../status` and in the guide's day
section, so an agent knows the contract before its first refusal rather than
from it.

Not doing: rewriting days already on disk, re-refusing them, or touching the
shape checks in `lib/validate/entry.ts` — those answer a different question.

## Acceptance

- A trip with no `tracks:` block refuses a day carrying no `costs`, and the
  refusal names `"costs": false` as plainly as it names the field.
- `"costs": false` writes `without: [costs]` and the day is accepted.
- `tracks: {costs: false}` on the trip accepts the same day silently.
- Publishing a day with no photographs on a photo-tracking trip is refused;
  `"photos": false` publishes it.
- A day already on disk is neither rewritten nor re-refused.
- `npm run verify` green.
