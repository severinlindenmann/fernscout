---
id: B507
title: The photobook composer is a desktop sidebar on a phone-shaped job
type: FEATURE
priority: medium
complexity: high
area: photobook, ui, mobile
found: "2026-09-05T17:50:06Z"
---

# B507 — The photobook composer is a desktop sidebar on a phone-shaped job

## Why

The composer B504 shipped is a `minmax(0,20rem)` sidebar beside a preview pane.
That is a desktop shape, and it is the wrong way round for the job.

Arranging a book is a long, fiddly, one-day-at-a-time task done while looking
at photographs — which is a phone activity for most people, and certainly for
somebody doing it on a sofa rather than at a desk. On a narrow screen the
current layout stacks a 20rem column of accordion rows above an iframe that
wants to be large, and neither gets the room it needs.

It is also less flexible than the job wants. A day can choose one of six
arrangements and which photographs are in it. It cannot reorder them by hand,
say which photograph is the big one, or carry a note about why.

## Work

Design first — this is the third change to this surface in a day and it
deserves a spec rather than another pass of edits. What the spec has to settle:

- **What the phone layout is.** Probably: the day list *is* the page, one day
  opens to a full-screen editor, and the preview is somewhere you go rather
  than something beside you. Desktop then puts the two side by side, which is
  the easy direction.
- **How the preview behaves when it is not on screen.** It is a server
  round-trip per change today, debounced. On a phone that is bandwidth and
  latency somebody is paying for.
- **What "more flexible" is worth.** Reordering photographs by hand, choosing
  which one is the hero, per-day captions. Each is real work and each adds a
  thing to explain; the spec should say which are in and why the rest are not.
- **Whether an arrangement survives leaving the page.** It does not today.
  Eighteen days of choices lost to a phone locking is the failure that makes
  people stop using a thing. `localStorage` is probably the honest answer
  before a server-side draft.

Wait for B506's findings before writing the spec: half of what belongs in it is
what a person notices the first time they use the thing.

**Not doing:** turning the composer into a page editor. `plan.ts` still decides
geometry — which page, which hand, where the gutter is — and that boundary is
what keeps the book good when somebody stops fiddling.

## Acceptance

- A spec in `docs/superpowers/specs/`, agreed before code.
- The composer is usable one-handed on a 390px screen.
- An arrangement survives the tab closing.
