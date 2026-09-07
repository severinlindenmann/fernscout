---
id: B703
title: A day's text cannot be left out on its own, and the layout names say nothing about what they look like
type: FEATURE
priority: medium
complexity: medium
area: photobook, composer
found: "2026-09-07T00:00:00Z"
merged: "2026-09-07T11:22:04Z"
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

## Findings (2026-09-07)

Both halves built.

**`DayPlan.text`.** Absent means "as the book says"; `false` is the only other
value that does anything. `planBook` computes one `wantsText = options.includeText
&& chosen?.text !== false` and both the day's paragraphs and its captions read
it, so a day narrows the book and can never widen it — `text: true` on a book
with `includeText: false` prints nothing, which a test pins. The heading and
the date stay, for the same reason the book-level switch leaves them: a photo
album that cannot say when it was is worse than one with a heading.
`setDayText` deletes the key when it is turned back on, so a day nobody has
touched stays indistinguishable from one set back. The checkbox only appears
when the book prints prose at all — on a book with text off there is nothing
to take away.

**`LayoutShape`.** Six schematic drawings, one per `DayLayout`, shown *beside*
each name in the picker rather than on hover: a phone cannot hover, and this
is information rather than a flourish. The picker's pills became small
rounded cards, 28px drawing over the label, `min-h-11` so they are still a
tap target. Not the day's own photographs — the question is how many frames
and how big, and a real thumbnail would answer a different one and change
whenever a photograph moved.

**Verified by looking**, per `check-a-drawing`: rendered all six through
`renderToStaticMarkup` and rasterised at 96px. `auto` (one big, two small),
`hero` (edge to edge, no margin), `single`, `pair`, `grid` and `text` are each
distinguishable from the others at a glance, and the last rule of a prose block
stops short the way a paragraph does. They are also on `/docs/branding/day`
now, at 96px, which is where somebody should look next.

`npm run verify`: all four passed (4308 tests).

**Left for a person:** the picker itself in a browser at 390px — six cards
with drawings is more furniture than six text pills were, and whether they
wrap acceptably on a phone is a thing to see rather than reason about.
