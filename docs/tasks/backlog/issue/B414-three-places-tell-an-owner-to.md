---
id: B414
title: Three places tell an owner to edit trip.md for a change the API can now make
type: ISSUE
priority: low
complexity: low
area: trips
found: "2026-09-05T08:27:14Z"
---

# B414 — Three places tell an owner to edit trip.md for a change the API can now make

## Why

B396 shipped `PATCH /api/v1/<user>/trips/<trip>/visibility`, which writes both
`visibility` and `listed`, owner only. Confirmed working on fernscout.ch
2026-09-05:

```
PATCH .../trips/only-trip-2026/visibility  {"listed": true}
-> 200 {"ok":true,"visibility":"public","listed":true, ...}
```

Several messages still send the owner to the file instead. The trips page's
empty state, seen by an owner whose only trip is unlisted:

> **Nothing listed here** — You have a trip, but its trip.md marks it
> `listed: false` ... **Set `listed: true` there to see it here.**

"There" is `trip.md`, which a hosted owner cannot open. The change itself is
now perfectly possible; only the instruction is stale.

This is the same pattern B352 and B396 each fixed once: a page naming a file
as the remedy after a door was built for it. Worth sweeping for the rest of
them in one pass rather than one ticket at a time — `rates`, `visibility` and
`listed` all have doors now, so any copy naming `trip.md` for those three is
out of date.

## Work

Find every message naming `trip.md` as the way to change something the API can
now write, and point at what the owner can actually do — as B352's
`cost.unconverted` does ("Ask an agent working on this journal to ...").

Leave alone the messages about fields that genuinely still have no door;
`people:` and `translations:` are still file-only (see B207).

## Acceptance

No rendered page tells an owner to edit `trip.md` for `visibility`, `listed`
or `rates`.
