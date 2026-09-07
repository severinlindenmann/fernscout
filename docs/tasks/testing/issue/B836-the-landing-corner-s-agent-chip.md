---
id: B836
title: The landing corner's Agent chip is too quiet to read as a button
type: ISSUE
priority: low
complexity: low
area: landing, agent
found: "2026-09-07T18:00:00Z"
merged: "2026-09-07T16:08:46Z"
---

# B836 — The landing corner's Agent chip is too quiet to read as a button

## Why

The owner, on B825 as merged: *"the Agent button on the main page — make it a
bit background colour so it stands out a bit, like a button to press."*

B825 drew it exactly as the operator chip beside it: transparent, no border,
`text-navy-600`. That was deliberate — the reasoning in the code was that the
hero already carries a primary call to action and a second loud control in the
corner would fight it. The reasoning was sound and the result was still wrong:
next to a language switcher, an unfilled word reads as a label, and nothing
about it says it can be pressed.

## Work

Give it a fill. **Navy rather than the hero's yellow**, for two reasons worth
writing down:

- The hero's "start writing" button leads to `/agent` as well. Two yellow
  buttons for one destination on one screen is repetition, not emphasis.
- Navy is what the agent control already wears inside a journal (B797), so the
  thing keeps one look wherever it appears.

The operator chip stays as it is: it is the operator's own door and does not
need to advertise itself to the one person who already knows it is there.

## Acceptance

- The chip has a fill and reads as pressable.
- It does not compete with the hero's primary button — different colour,
  different weight.
- Still ≥44px, still one row with the operator chip and the language switcher
  at 390px.
- Still gated on the `helper` capability.

## Done

`bg-navy-900` with `text-cream-50`, measured at 390px: **64×44**, background
`rgb(30, 41, 59)`, one row beside the switcher. Focus ring added at the same
time — it had none, having been drawn from a chip that inherits one.
