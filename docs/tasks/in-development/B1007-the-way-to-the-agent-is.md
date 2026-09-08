---
id: B1007
title: The way to the agent is the one control in the owner block with no button
type: FEATURE
priority: medium
complexity: low
area: components/OwnerTools.tsx, components/HelperAskHere.tsx, components/DraftNotice.tsx
found: "2026-09-08T18:11:37Z"
started: "2026-09-08T18:12:06Z"
session: 79cece02-4661-45ef-809b-52b592e67f95
claimed: "2026-09-08T18:12:06Z"
---

# B1007 — The way to the agent is the one control in the owner block with no button

## Why

B877 gave the owner block a shape: tiles above a rule are the shortcuts, and
under the rule is the same intent said in words — the place to go when no tile
fits. The proportion is right. The drawing is upside down: the general form is
the only thing in the block with no surface to press.

Three things make it read as a footnote (`components/HelperAskHere.tsx:71`):

- `min-h-11` on an `inline-block` link gives a tall tap target that is only as
  wide as its text, so the 44px is real and invisible. Every tile beside it is
  a filled rectangle.
- On a draft day the block often draws exactly one tile — `DayNotify` and the
  correction tile are both absent — so the rule separates one tile from one
  underlined line, and separates nothing.
- "Sprich mit deinem Agenten darüber" names a posture. Every tile beside it
  names an outcome ("Zum Lesen einladen").

The same door is drawn three different ways across the product, which is the
B877 drift one level up:

| | today |
| --- | --- |
| `HelperAskHere.tsx:71` | underlined link |
| `AgentDoor.tsx:278` | underlined link |
| `DraftNotice.tsx:54` | prose telling the owner to ask their agent to publish, with **nothing to press** — the page knows the route and does not offer it |
| `SearchBox.tsx:400` | already a button, different purpose (asking, not writing) — leave alone |

## Work

Variant "C+" from the design pass. One shared full-width action row, three
colourways, same geometry — icon plate, two lines of text, chevron, ≥52px:

- `AGENT_ROW` beside `OWNER_TOOL` in `components/ownerToolClass.ts`, for the
  same reason that one is its own module (importing back from `OwnerTools`
  would be a cycle).
- `HelperAskHere` keeps its `GET /api/helper/<user>/ask` gate and stays a
  `<Link>`; only its className and label change. New copy: title "say what is
  missing", subline "change, add, publish — in your own words".
- A **coral** row at the top of the owner block on an unpublished day, leading
  into the same room with the day in context. Coral because it is the colour
  the draft banner already wears; it disappears the moment the day is on the
  site, so the block gets quieter as work finishes, not louder.
- `DraftNotice` keeps its banner but loses the "tell your agent to publish it"
  sentence where the owner-block row is drawn, so one page does not make the
  same offer twice. `draft.bodyShared` (the traveller who cannot publish) is
  unchanged — that sentence is still true and there is still no button for it.
- `AgentDoor.tsx:278` takes the same row in white: `/agent` has already spent
  its one bright thing on the yellow wizard button.

Not doing: option D (agent promoted above the tiles), which reverses B877's
hierarchy rather than drawing it; and no change to `SearchBox`.

Locale keys: three new (two sublines + the draft row title) across `en`, `de`,
`hu`, one replaced. `npm run i18n:keys` after, or the build fails twice over.

Watch for a conflict with B980 (in-development, touches `OwnerTools`'s
`onCorrect` path).

## Acceptance

- `npm run verify` clean.
- `/docs/branding/day` or a signed-in day page at 390px: on a **draft** day the
  block draws the coral row, the tiles, and the yellow agent row — three
  full-width elements at ≥52px, no underlined link anywhere in the block.
- On a **published** day the coral row is absent and nothing else moves.
- With the helper capability off, no agent row and no coral row is drawn, and
  the block is exactly what it is today minus the underlined link.
- The draft banner and the owner block do not both offer "publish" on the same
  page.
- `site/locales/{en,de,hu}.json` cover every new key; German and Hungarian are
  written, not machine-shaped.
