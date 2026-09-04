---
id: B15
title: The travel scene plays one fixed sequence and nothing can choose another
type: FEATURE
priority: low
complexity: medium
area: animation, api, mcp
found: "2026-09-01"
started: "2026-09-04T15:49:34Z"
session: 67c9cca1-5b74-49e7-b1a4-dbee6bf7ce21
claimed: "2026-09-04T15:49:34Z"
---

# B15 — The travel scene plays one fixed sequence

## Why

> **Stale reference, 2026-09-04.** B298 removed MCP: there is no `lib/mcp/`
> and no `/api/mcp`. Every mention of an MCP tool or endpoint below describes
> deleted code, and "the network door" now means the REST API alone. The
> reasoning is unchanged — the paths it names are one fewer than it says.

Between two days the story pager plays `components/TravelScene.tsx`: the
travellers set off, a vehicle crosses — arcing for a flight — and the
destination rises. It is 151 lines, it runs for a constant
`TRAVEL_DURATION = 6` seconds (`components/TravelScene.tsx:26`), and it takes
exactly two props: `leg` and `onDone`.

Everything about how it looks is decided inside the component. The one thing
the content can influence is which of seven icons flies across, via
`VEHICLE_ICON` at `components/TravelScene.tsx:15` keyed off the day's
`transport.mode`. So a six-week rail trip plays the same six-second animation
between every pair of days, forty times, and the reader who has seen it twice
is watching a loading screen.

The pieces are already separate and reusable — `Cityscape`, `Travelers`, the
`TRANSPORT_STYLE` table in `lib/transport.ts` — so the shape of this is a
choice of scene, not a rewrite.

Nothing on the write side can express a choice either. `create_day`
(`lib/mcp/tools.ts:744`) and the REST day endpoint accept the day's fields;
neither has any notion of how the transition to that day should play, because
there is no field for it.

Related: B11 is who the figures are. This is what the scene does with them.
They touch the same components and should not be done in one change.

## Work

1. **More than one scene, and a reason to pick each.** A short overnight hop
   is not a transoceanic flight and should not take the same six seconds. At
   minimum: duration derived from the leg (distance is already computable from
   the day's `lat`/`lng`), and two or three distinct treatments rather than one.
2. **A named variant on the day.** An optional field in entry frontmatter —
   the scene, or an intensity, or "skip it entirely", which is the one a
   reader on their fortieth leg most wants. Absent means today's behaviour.
3. **Readable and writable by an agent.** Add it to the `create_day` schema
   and the REST day representation, and expose the list of valid variants
   through a read tool so an agent picks from what exists instead of guessing
   a string. An unrecognised variant falls back to the default and does not
   break the page — the same rule `visibility` follows.
4. **Reduced motion stays absolute.** `TravelScene` already collapses to 0.01s
   under `prefers-reduced-motion` (`components/TravelScene.tsx:50`). No variant
   may opt out of that.

Not doing: making the animation configurable from the browser. There is no
editing interface (decision 24).

## Acceptance

- Two days with different variants play visibly differently in the demo
  journal, and a day with no variant plays exactly what it plays today.
- `create_day` round-trips the field into the entry file, and an unknown value
  renders the default rather than throwing.
- A `prefers-reduced-motion` reader gets no animation from any variant.
- The story pager's day-to-day timing still lines up — `onDone` fires once per
  leg for every variant, or the pager stalls.
