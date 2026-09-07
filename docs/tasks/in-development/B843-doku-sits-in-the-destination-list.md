---
id: B843
title: Doku sits in the destination list though it leaves the journal, and Agent reads as a row rather than a button
type: ISSUE
priority: medium
complexity: low
area: header, nav
found: "2026-09-07T18:35:00Z"
started: "2026-09-07T17:09:29Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T17:09:29Z"
---

# B843 — Doku sits in the destination list though it leaves the journal, and Agent reads as a row rather than a button

## Why

The owner, on B824 as merged: *"make the Doku go to the right next to the
language selector, and the agent also give it a background colour."*

B824 made Agent and Doku plain rows at the top of the menu list, which was the
right correction to B797's banner. Seeing it in place shows the two do not
belong to the same category as each other:

- **Doku is not a destination in this journal.** Reise, Galerie, Karte,
  Auswertung, Reisen and Suche are all places inside the journal you are
  reading; `/docs` is the software's own documentation and leaves it entirely.
  Listing it among them says it is one of them. The chips row above — trip,
  currency, language — is already where the things that are *not* destinations
  live, and it is where the owner is pointing.
- **Agent is an action, not a place.** It is the one row in that list you press
  to go and write, and it currently looks exactly like the six rows that just
  move you around. The landing page's own Agent chip was given a fill for this
  reason in B836; the same argument applies here, and using the same treatment
  keeps the thing recognisable wherever it appears.

## Work

- Move Doku into the chips row, to the right, beside the language switcher.
  Draw it as those chips are drawn — it is joining a set, not arriving as a
  new kind of control. Icon-only is likely right there, with an
  `aria-label`; check the row still fits at 390px with four chips and report
  the measurement.
- Give the Agent row a fill. `bg-navy-900` with `text-cream-50`, matching B836
  and the agent control's look elsewhere. **Not `yellow-400`** — yellow means
  "you are here" in this panel, and the active destination is already wearing
  it directly below.
- Keep the `helper` gate on Agent, and keep Doku ungated (B802).
- Everything stays ≥44px.

## Acceptance

- Doku is in the chips row beside the language switcher; the destination list
  is only destinations.
- Agent has a fill and reads as the thing to press.
- The active destination is still the only yellow thing in the panel.
- The chips row does not wrap at 390px — state the measured widths.
- With `helper` off, Agent is absent and Doku is still there.

## Blocked until B822 merges

Both changes are in `components/PageHeader.tsx`, which B822 (the back arrows)
is editing. Do not start these in parallel.
