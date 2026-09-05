---
id: B11
title: The travellers are always the same two people
type: FEATURE
priority: low
complexity: medium
area: animation, brand, agent-interface
found: "2026-09-01"
started: "2026-09-05T15:51:50Z"
session: c3c8ffc8-e9b2-4d46-b1b7-942387750255
claimed: "2026-09-05T15:51:50Z"
---

# B11 — The travellers are always the same two people

**The design is `docs/plans/2026-09-05-traveller-characters.md`.** It carries
the attribute schema, the preset question, the layer order and the agent
interview, with the reasoning. This file is the ticket.

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
2. **It is a composition, not a row.** The party stands close enough that
   shoulders, arms and packs **overlap** — a row of evenly spaced figures
   reads as a line-up, not a group. The step goes below a figure width as the
   party grows, floored at **0.62 of a width**: the head spans half a figure,
   so anything tighter puts one head squarely over another, which reads as a
   rendering bug rather than as depth. Past three the party also stands in
   **two ranks**. Children and teenagers take
   the front one at any size — `AGE_SCALE` makes them shorter, so behind an
   adult they are simply gone; two parents and two children is four figures
   with the children in front. With no children, four or more alternate, so a
   group of five friends stands some in front and some behind; one to three
   adults stay a single row. Every figure gets its own column and depth
   alternates along the line — centring each rank and nudging the front one
   half a step is the obvious version and it is wrong, because when the counts
   differ by one both ranks land on the same x and the back rank disappears.
   The front rank is drawn last, sits a few pixels lower on the ground, and is
   scaled ~6% up against the back rank's 6% down — all three
   together, because any one alone reads as a mistake. **Derived from the list
   index, never random**, so the hero and the photobook agree and a refresh
   does not reshuffle the family.
3. **A figure is data.** Skin, hair colour, hair style, eyes, build, age,
   shirt, pants, pack, accessories — a named record with a vocabulary of
   tokens, hex allowed as the escape hatch, and ready-made **starting points**
   an author picks rather than mixing hex codes. They span more than one part
   of the world; this is the whole point of the task.
4. **A starting point resolves when it is chosen.** It expands into plain
   attributes and the preset name is never written to disk. No file under
   `content/` should contain the word `european`: that would be a sentence
   about somebody's ethnicity in a file the owner did not think they were
   writing, and it would be false anyway once they corrected it.
5. **Its own block, not inside `people:`.** `parsePeople` (`lib/trips.ts:139`)
   fails closed — one malformed entry drops the whole list, and that list is
   who may write to the trip. A cosmetic field must not be able to revoke
   write access, so `travellers:` is separate, parses independently, and fails
   open to the neutral default. An optional `for:` ties a figure to an email
   in `people:`.
6. **Where it is configured.** `travellers:` in the journal's `config.json`,
   overridden per trip in `trip.md` — a trip is who was on it, and that
   changes between trips in one journal. Absent means one neutral figure, not
   the current two.
7. **One renderer, three consumers.** `lib/travellers/render.ts` is pure —
   figure in, SVG out, no React. The component wraps it in `motion`;
   `GET /api/v1/<user>/travellers/preview` returns it as `image/svg+xml`; a
   node script renders a sheet for an agent with no server running.
8. **Reachable by agent.** `GET …/travellers/presets` lists the vocabulary and
   the starting points so an agent offers what exists instead of inventing hex
   codes, and `lib/tripWrite.ts` plus the REST trip endpoints round-trip the
   block. Not owner-only: a trip-scoped token belongs to somebody on the trip,
   and how they are drawn on it is theirs.
9. **The agent asks.** A `describe-a-traveller` skill and a section in
   `/agent.md`: ask *how would you like to be drawn*, render it, show them,
   read back what was set **and what was left at the default**, write on yes.

**Reversing an earlier line in this ticket.** It used to say free-text →
figure was out of scope as agent invention. That is too broad: the rule in
`AGENTS.md` is that *what happened* is never an agent's to decide, and a
person describing their own hair is not the agent inventing it. What the skill
must forbid instead, in as many words — no inference from a name, from a
photograph on the trip, or from a country, and an unanswered attribute gets
the neutral default rather than a plausible guess.

**Open question for the author, argued in the plan:** there is no `gender`
field in the proposed schema. Everything it would control is already a
directly chosen attribute (hair style and length, clothing, `build`), and a
two-way switch would make the software assert something about a person and
leave a non-binary traveller nowhere. Gender lives in the *picking* instead —
starting points are labelled by presentation. If you want the field anyway it
is one line; say so.

Not doing: a character editor in the browser (decision 24). The preview is
read-only and has no controls. Not doing: per-entry figures, or faces derived
from photographs.

## Acceptance

- A journal configured with one traveller shows one figure; five shows five,
  laid out without overflowing the hero on a phone.
- **No head is drawn over another head, at any party size up to ten** — a test
  measures the rendered head circles and asserts a positive gap between every
  adjacent pair. This is the acceptance criterion for the overlap: bodies may
  cross, heads may not.
- No skin or hair colour is a module constant in `Travelers.tsx` any more.
- A malformed `travellers:` entry draws the neutral default and does **not**
  change what `peopleOf()` returns — a test asserts write access survives a
  broken hair colour.
- No file under `content/` contains a starting-point name.
- `GET /api/v1/<user>/travellers/presets` lists the vocabulary, and
  `GET …/travellers/preview` returns an SVG for a figure given in the query.
- A trip create/update round-trips a `travellers:` block into `trip.md`.
- A journal with no `travellers:` configured still renders, unchanged in
  layout, and `npm run build` prerenders the demo journal as before.
