---
id: B11
title: The travellers are always the same two people
type: FEATURE
priority: low
complexity: medium
area: animation, brand, mcp
found: "2026-09-01"
---

# B11 — The travellers are always the same two people

## Why

> **Stale reference, 2026-09-04.** B298 removed MCP: there is no `lib/mcp/`
> and no `/api/mcp`. Every mention of an MCP tool or endpoint below describes
> deleted code, and "the network door" now means the REST API alone. The
> reasoning is unchanged — the paths it names are one fewer than it says.

`components/Travelers.tsx` draws two figures and only ever two. The palettes
are module constants with a comment that says what they are:

```ts
// Us: two white European travellers — him with short brown-blond hair, her
// with long brown hair. Tweak these if you want to fine-tune the likeness.
const HIM = { skin: "#f7d7bb", hair: "#a67c42", … };
const HER = { skin: "#f9dcc4", hair: "#6b4423", … };
```

`Travelers` takes one prop, `size`. Nothing else is configurable, and the two
callers — `components/TravelScene.tsx:111` and `components/TripHero.tsx:210` —
pass only that. So a solo traveller's journal shows two people; a family of
five shows two people; anybody who is not white shows two white people.

For a self-hostable journal this is the wrong default in a way that is
noticeable on the first screen. The comment is honest about it — the figures
were drawn as a likeness of one particular couple, which is fine for that
couple and is now hard-coded into everybody else's site.

The trip already knows the answer, or most of it: `people:` in `trip.md` lists
up to ten, and `lib/tripPeople.ts` resolves them owner-first.

## Work

1. **A party, not a couple.** `Travelers` takes a list of figures and draws
   them — one, two, a group, a family with children at a smaller scale. Keep
   the gait offset per figure so a group does not bob in lockstep.
2. **A figure is data.** Skin, hair colour, hair length, build, height,
   clothing — a small named record, with a set of ready-made presets so an
   author picks rather than mixes hex codes. Presets must span more than one
   part of the world; this is the whole point of the task.
3. **Where it is configured.** A `travellers:` block in the journal's
   `config.json`, overridable per trip in `trip.md` — a trip is who was on it,
   and that changes between trips in one journal. Absent means a sensible
   neutral default, not the current two.
4. **Reachable by agent.** The trip write path (`lib/tripWrite.ts`, the REST
   trip endpoints and the `create_trip` MCP tool at `lib/mcp/tools.ts:708`)
   should accept the block, and a read tool should be able to list the
   available presets so an agent can offer them rather than invent hex codes.
   Generating a figure from a free-text description is out of scope — an
   agent choosing somebody's appearance from a prompt is exactly the kind of
   invention `AGENTS.md` forbids.

Not doing: a full character editor in the browser. There is no editing
interface and there will not be one (decision 24).

## Acceptance

- A journal configured with one traveller shows one figure; five shows five,
  laid out without overflowing the hero on a phone.
- No skin or hair colour is a module constant in `Travelers.tsx` any more.
- The preset list is readable through MCP, and `create_trip` round-trips a
  `travellers:` block into `trip.md`.
- A journal with no `travellers:` configured still renders, unchanged in
  layout, and `npm run build` prerenders the demo journal as before.
