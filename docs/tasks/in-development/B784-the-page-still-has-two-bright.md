---
id: B784
title: The page still has two bright buttons even though the card has one
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T14:29:54Z"
started: "2026-09-08T21:14:15Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:14:15Z"
---

# B784 — The page still has two bright buttons even though the card has one

## Why

B767 made the journal card have exactly one bright control. The *page* still
has two: `components/AgentHandover.tsx:112` renders a second `bg-yellow-400`
button ("Schlüssel und Anleitung holen") below the rule on the same screen.

So the work that gave the person one obvious thing to press is undone a scroll
further down by a button of equal weight offering something only a technical
person wants.

The component is shared with `/<user>/me` and `/<user>/trips`, which is why
B767 left it alone: recolouring it is a decision about three pages, not one.

## Work

Decide what weight the bring-your-own-agent panel carries on each page it
appears on. On `/agent` it is the second door and should look like it; on
`/<user>/me` it may well be the primary thing. A variant prop is probably
enough.

## Acceptance

`/agent` has one bright button on the whole page.
