---
id: B888
title: The box points at buttons that are not on the screen
type: ISSUE
priority: high
complexity: low
area: agent, i18n
found: "2026-09-07T18:24:54Z"
started: "2026-09-07T18:25:43Z"
merged: "2026-09-07T19:07:21Z"
completed: "2026-09-09T16:47:25Z"
---

# B888 — The box points at buttons that are not on the screen

## Why

`agent.askUnknown` reads, in German:

> "Dazu passt hier nichts. **Die Knöpfe darunter** machen alles von Hand."

It was written when the ask box lived on `/agent`, with the buttons beneath it.
B844 moved the box onto the day page and the trip overview, where the owner
tiles are **above** it — and B877 then put the box *inside* the owner block,
below a hairline, with nothing under it at all.

So the one sentence a person sees when the helper does not understand them
points at furniture that is not on the screen. The owner read it and asked
"which buttons?".

It is small, and it is the sentence that lands at the exact moment somebody is
already confused.

Check the rest of the `agent.*` strings for the same drift while there: two
rounds of rearrangement have moved things the copy still describes by position.
`agent.askOpen` ("Oder frag mich etwas") and `agent.askHereOpen` ("Bitte um
etwas anderes") now sit in different places and should not both exist if one
box is left.

## Work

Say what is true where the box actually is: nothing matched, and here is what
it can do — or point at the tiles by name rather than by direction. Never by
position; the position has changed twice in a day.

## Acceptance

No string describes where something is on the screen.
