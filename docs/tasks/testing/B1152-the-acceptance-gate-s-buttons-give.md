---
id: B1152
title: The acceptance gate's buttons give no feedback and its second label says nothing, so a person cannot tell what they chose or where a ticket is
type: DOCS
priority: medium
complexity: low
area: skills
found: "2026-09-09T18:42:57Z"
merged: "2026-09-09T18:48:45Z"
---

# B1152 — The acceptance gate's buttons give no feedback and its second label says nothing, so a person cannot tell what they chose or where a ticket is

## Why

The acceptance gate B1111 added to `report-a-run` shipped in its first real
run on 2026-09-09 and the owner hit three usability faults in the first
minute, none of which a test could have caught:

- **A clicked button did not look clicked.** The selected state was a pale
  tint (`--go-fill` behind `--go` text) that read as no change against the
  panel. The owner's words: *"accept should be marked when clicked"* — it was,
  technically, and invisibly.
- **The second verdict was labelled "needs another look",** which says nothing
  about what it *does*: *"what does the button needs a look do? for me
  nothing"*. A button in a flow must say its consequence, not a mood — the
  same rule AGENTS.md already states for `ConfirmPanel` (a button that says
  what it does rather than "OK").
- **No way to get from a row to the ticket it decides.** The gate lists ids at
  the bottom; the evidence for each is a card far up the page: *"how can i
  scroll or see directly where it is"*. A decision surface that makes you hunt
  for what you are deciding on gets decided blind.

## Work

Fold the fixes into `report-a-run`'s step 6, and — because `triage-a-backlog`'s
decision bar is the shared machinery step 6 builds on and has the identical
buttons — into that skill's step 6 too, so the two do not drift:

- **A chosen verdict fills solid** — the accent or a semantic colour as the
  button *background* with contrasting text, not a tint behind coloured text.
  The rule to write down: the selected state must be legible across the room,
  not on inspection.
- **A verdict label says its consequence.** "Accept" (→ `completed/`) and
  "Hold to see live" (→ stays in `testing/`), not "needs another look". A
  one-line legend above the rows spells out where each sends the ticket.
- **Each row's id is a control that scrolls to and briefly highlights that
  ticket's card**, with `scroll-margin` on the card so the sticky bar does not
  cover it.

State the general rule these three share, since it is the reusable part: **the
gate is a control surface, so every element on it obeys the UI half of
`artifact-design`, not the document half** — state shows in form as well as in
words, a control names its consequence, and what it refers to is reachable.
The narrative report above the gate stays a document; the gate is not.

## Acceptance

- Both skills' step 6 describe the filled selected state, the
  consequence-naming labels with a legend, and the row-to-card jump.
- The rule that the gate is a control surface (not a document) is stated once,
  where both can see it.
