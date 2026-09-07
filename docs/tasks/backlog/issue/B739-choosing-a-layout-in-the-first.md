---
id: B739
title: Choosing a layout in the first-book flow asks a question at the top of the page about days the flow itself arranged
type: ISSUE
priority: high
complexity: low
area: photobook, onboarding
found: "2026-09-07T00:00:00Z"
---

# B739 — Choosing a layout in the first-book flow asks a question at the top of the page about days the flow itself arranged

## Why

Reported against the live site, in two halves, and both are right.

**It appears above.** B727's *How should a day look?* calls the composer's own
`applyLayoutToAll`, which raises `ConfirmPanel` through `pending` — and that
panel is rendered once, at the top of `PhotobookPageContent`, beside the
outcome notice. B668 put it there deliberately, because its two callers live
several components down and one panel serves both. That reasoning holds for
those two and not for this one: the flow's cards are the whole screen, so the
question about them scrolls off the top of it. A confirmation you have to go
looking for is worse than none.

**It asks about work nobody did.** The wording is
*"9 andere Tage wurden von Hand gestaltet und bekommen ebenfalls dieses
Layout"* — and on a fresh book nobody has arranged anything by hand. The nine
days are the flow's *own* previous tap: choosing "one big picture" writes a
layout onto every day, so choosing "four to a page" a moment later finds nine
days with an override and warns about them. The guard is right for the day
controls, where every override really was somebody's, and wrong here, where
the flow is the thing that wrote them.

`applyLayoutToAll` at `PhotobookPageContent.tsx:427`; the flow calls it from
`FirstBookFlow.tsx`'s `layout` step.

## Work

- The flow asks its own question, underneath the cards, in the same panel
  component — `ConfirmPanel` is a panel in the flow by design, and this is
  what "in the flow" means here.
- It asks about **work that predates the flow**, not about its own: snapshot
  which days carry a layout override when the flow opens, and ask only about
  those, once. Every later tap applies straight away.
- Not doing: moving the shared panel. The day controls' two callers still want
  it where it is.

## Acceptance

- Tapping through several layouts in a row asks nothing on a book nobody has
  arranged by hand.
- Opening the questions again on a book whose days *were* arranged by hand
  asks once, underneath the cards, and only names those days.
- Nothing in the flow raises the panel at the top of the page.
