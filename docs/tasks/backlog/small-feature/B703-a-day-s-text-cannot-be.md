---
id: B703
title: A day's text cannot be left out on its own, and the layout names say nothing about what they look like
type: FEATURE
priority: medium
complexity: medium
area: photobook, composer
found: "2026-09-07T00:00:00Z"
---

# B703 — A day's text cannot be left out on its own, and the layout names say nothing about what they look like

## Why

The per-day controls are further along than they look: `DayControls.tsx`
already offers six layouts, a hero, reordering, leaving photographs out,
leaving the whole day out, and a focal point per picture. Two things are
missing, and both were asked for by the owner making a real book.

**Text is all-or-nothing.** `includeText` is one switch for the whole book
(`options.ts`). A trip usually has two or three days whose prose is a line of
logistics — *drove four hours, arrived late* — and every other day worth
printing. Today the choice is to print all of it or none of it. `DayPlan`
already carries per-day decisions (`excluded`, `layout`, `hero`, `photos`,
`runOn`), so this is one more field of the same kind, not a new mechanism.

**The layout names are words for something visual.** "Raster", "Paar", "Held"
tell somebody who has not seen the planner nothing at all, and the only way to
find out is to pick one and watch the whole book re-plan. The names should
show what they mean before they are chosen.

## Work

- `DayPlan.text?: boolean` — absent means "as the book says", `false` means
  leave this day's prose out. Reaches `planBook` the same way `excluded` does.
  The book-level switch stays what it is; the day narrows it and never widens
  it past a book with `includeText: false`.
- A small diagram per layout in the day's layout picker — frames on a page,
  drawn from the same arrangement names the planner uses, shown on hover and
  on focus and legible on a phone where there is no hover at all. Not a
  screenshot of the day's own photographs; a picture of the *shape*.
- The diagrams belong on `/docs/branding/day` too, since that bench exists to
  hold exactly this kind of drawing still.

## Acceptance

- One day's prose can be left out while the rest of the book keeps its text.
- Every layout in the picker shows its shape without being chosen.
- A phone reaches the same information without hovering.
