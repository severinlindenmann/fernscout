---
id: B534
title: The composer asks for everything at once, so the default path is as long as the expert one
type: FEATURE
priority: high
complexity: high
area: photobook, composer, ux
found: "2026-09-06T07:53:48Z"
---

# B534 — The composer asks for everything at once, so the default path is as long as the expert one

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The composer is one page carrying everything: the book's settings, every day's
controls, the whole preview, the warnings, the price and the Pay button. Someone
who would have been perfectly happy with the arrangement the planner chose still
scrolls past every control in the book to reach Pay. The default path and the
expert path are the same length, and on a phone — which is the width this page
is designed for — that is the whole experience.

The shape asked for was a wizard: general settings, then a generated preview,
then a page-by-page editor. Two of those three are right. The research says the
third is a trap, and so does this codebase.

### What the research says

Nielsen Norman's account of progressive disclosure separates two patterns.
*Staged* disclosure is the wizard: a linear sequence of steps. *Progressive*
disclosure proper is hierarchical: an initial display, a drill-in, and a return.
Their finding is that **staged disclosure "is problematic when the steps are
interdependent and users must alternate between them"**, and that designs going
beyond two levels "typically have low usability because users often get lost".

Our steps are interdependent, precisely. The trim size decides how much prose
fits a page, which decides which days overflow, which decides which days want
`runOn`. The language changes the text. `includeText` changes every day page.
A person who reaches the per-day step, discovers the book is too small, and has
to walk back through a wizard to change it has been failed by the shape of the
screen.

A review of photobook software makes the same point from the other end, listing
**"inability to change book dimensions mid-project without restarting"** among
the field's recurring pain points. A linear wizard here would ship that bug on
purpose.

The same review is warm about auto-generate-then-refine — Shutterfly's "Make My
Book", Chatbooks' auto-generation — and concludes that good UX is software that
"gets out of your way" rather than imposing a workflow. That is the half of the
proposal to keep.

### Why not page-by-page

Pages are derived, not authored. `expandToMinimum` pads to the binder's
minimum, a long book splits into volumes, and B517 lets one day become two
pages. Turn on `runOn` for an early day and every later page renumbers, so an
edit stored against a page index silently reattaches to different content.

The stable key already exists and it is the day: `options.days` is
`Record<date, DayPlan>`, and every per-day setting — layout, hero, chosen
photographs, `runOn` — is keyed by date and survives a re-plan. Dates do not
renumber.

There is a second reason. B514 made the preview show spreads because a bound
book is read as facing pages, and it earned that immediately by exposing B518,
the route map sitting in the fold. A stack of single pages would undo it.

## Work

Two levels, hierarchical, never linear. Exactly the two NN/g allows.

**Level 1 — the book.** The settings that describe the whole book (size,
language, cover, what to include), the live spread preview, the warnings, the
price, Pay. This is the entire journey for somebody who likes what the planner
did, and it must be short enough to reach Pay without wading through per-day
controls.

**Level 2 — one day.** Reached by drilling in from a spread in the preview:
*this spread is wrong, fix this spread*. Shows that day's controls with that
day's spread beneath them, which is the good idea in the original proposal —
the control and the thing it changes in one glance instead of at opposite ends
of the page. Returns to level 1.

Drill-in from the preview replaces the day accordion rather than joining it.
Two ways to reach the same controls is the thing that made this page long.
A day is found by scrolling the preview, which is in book order.

The front matter — cover, route map, costs — belongs to no day and still needs a
home. It gets the same treatment: drill in from its spread.

Nothing is locked behind a step. Every level-1 setting stays one tap away from
every level-2 screen, because that is the interdependence the research warns
about.

**Not doing:** free-form drag-and-drop placement. The planner's arrangement is
the product; this ticket is about reaching and adjusting it, not replacing it
with a canvas.

**Watch for:** the preview is a debounced server round-trip
(`PhotobookPageContent.tsx`), not a client-side render. Drilling into a day must
not become a second request shape — level 2 shows a slice of the preview
already fetched.

## Acceptance

- From opening the composer, Pay is reachable without passing a single per-day
  control, at 390px.
- Changing the trim size is possible while looking at one day's spread, without
  losing that day's settings or restarting.
- A per-day setting made before a change that renumbers pages (`runOn` on an
  earlier day, a volume split) still applies to the same day afterwards.
- The day accordion is gone, not supplemented.
- Existing arrangements in localStorage still load: `days` is keyed by date and
  that does not change.

## Sources

- Nielsen Norman Group, *Progressive Disclosure* —
  https://www.nngroup.com/articles/progressive-disclosure/
- *Photobook UX Review: Which Software Is Easiest to Use?* —
  https://blog.teoprint.com/photobook-ux-review/
