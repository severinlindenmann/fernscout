---
id: B1398
title: "Choosing the postcard picture means picking a day from a list of titles, never seeing a photograph"
type: FEATURE
priority: medium
complexity: medium
area: the web helper, postcards
found: "2026-09-10T21:05:00Z"
---

# B1398 — Choosing the postcard picture means picking a day from a list of titles, never seeing a photograph

## Why

*erstelle mir eine postkarte* answers with a `choose` block listing the trip's
days as text:

> **Tage dieser Reise** — Ein Tag mehr in Basel · 2026-06-22 — Spät angekommen
> · 2026-06-22 — Vom ersten ins zweite Hotel · 2026-06-23 — Windig an der Praia
> da Rocha · 2026-06-24 — … *(fourteen rows)*

A postcard is a photograph. The person is choosing which picture goes in
somebody's letterbox, and what they are shown is a column of titles and dates —
so they have to remember which day the good photograph was on, pick it blind,
and find out afterwards. Fourteen rows on a phone is a scroll, and none of it
shows the thing being chosen.

The list is a day chooser because the tool underneath is day-shaped:
`propose_postcards` (`lib/helper/tools/areas/printed.ts:144`) resolves a day and
then takes `entry.gallery[0]` unless a filename is named (`:191-196`) — the
`photo` argument is *"by its file name as read_day names it"*, which is not
something a person says out loud. So the flow asks for the container because
the tool cannot be given the picture.

`postcard_recipients` right beside it already renders a `choose` block of
people (`:53-80`), so the block vocabulary is there; there is no picture block
yet.

## Work

Show photographs and let one be picked.

- A picture-grid block for the helper's block vocabulary (`lib/helper/blocks.ts`
  and its renderer), alongside the existing `choose`. Thumbnails, tappable, one
  selected — the files pane already draws tiles for staged media, so check
  whether that can be reused before drawing a second grid.
- Which photographs: the trip's, across its days, newest first, rather than a
  day at a time. The day is then a *filter* on the grid, not the question asked
  first.
- The chosen photograph carries whatever the order needs — day, trip and
  filename — so the model never has to be told a filename and the person never
  has to know one.
- Media is gated. A photograph may carry `visibility: guest` or `private`
  (B596) and `app/[user]/media/[...path]/route.ts` refuses the file
  accordingly; the grid must go through the same paths a reader would, and
  thumbnails, not originals.
- Watch the payload. Fourteen days of a trip is a lot of images to put in a
  conversation — page it, or cap it and say what was capped (`AGENTS.md`: no
  silent caps).

**Pairs with B1393**, which widens the same tool to accept a staged inbox file
as the picture. If both are built, the grid should show *what is staged* as
well as what is on a day — that is the same question the person is answering.
Build B1393 first; this is the face on it.

**Not in this ticket.** No change to who may press send, to what a card costs,
or to how addresses are handled.

## Acceptance

- *erstelle mir eine Postkarte* on a trip with photographs offers pictures to
  choose from, not only titles. In a browser at 390px
  (`test-in-a-browser`), because it is a drawing.
- Picking one reaches the proposal with that photograph on the card, and the
  order page shows the same picture.
- A trip whose days have no photographs says so plainly rather than showing an
  empty grid.
- A `private`-marked photograph does not appear to a reader who may not see it,
  and its file is still refused directly.
- `npm run verify` clean.
