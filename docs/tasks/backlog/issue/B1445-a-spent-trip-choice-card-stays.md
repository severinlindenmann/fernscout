---
id: B1445
title: A spent trip-choice card stays a pressable button that does nothing
type: ISSUE
priority: low
complexity: low
area: helper, room
found: "2026-09-11T11:11:06Z"
---

# B1445 — A spent trip-choice card stays a pressable button that does nothing

## Why

Found in a live owner session on fernscout.ch, 11 September 2026.

The room's "Trips in this journal" card renders each trip as a real `<button>`.
After the trip has been chosen and the conversation has moved on, those buttons
stay on screen and stay pressable — and pressing one does nothing at all: no
request leaves the page (`window.fetch` was instrumented; zero POSTs in eleven
seconds), nothing changes, and the card's own footer answers
*"Take a look at the options already given — pick one."*

A spent control that still looks live is a small thing that costs a person real
confidence: they press, nothing happens, and the only reading available to them
is that the page is broken.

The honest behaviour for a spent card is the one the room already has for other
states — the control stops being a control.

## Work

Disable or de-emphasise a choice card's buttons once the choice it offered has
been made, the same way the proposal cards do. Check whether the nudge
("pick one") should still render under a card whose options are spent.

## Acceptance

- After a trip has been chosen, the trip cards are not focusable buttons.
- No visible control in the room is pressable and inert.
