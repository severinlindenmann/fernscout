---
id: B507
title: The photobook composer is a desktop sidebar on a phone-shaped job
type: FEATURE
priority: medium
complexity: high
area: photobook, ui, mobile
found: "2026-09-05T17:50:06Z"
started: "2026-09-06T14:20:16Z"
merged: "2026-09-06T14:47:38Z"
completed: "2026-09-07T13:11:30Z"
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

## What actually happened

B506 was never verified (still sitting in `testing/ops`), but by the time this
was picked up ten sibling tickets had already rebuilt the surface this ticket
worried about — B511–B517, B534, B548–B551, B561–B564, B569 — apparently
because somebody looked at the composer in a browser along the way regardless
(see the "what came back from looking at the composer" commits). Reading the
code found: two levels, hierarchical, never a wizard (B534); the book first
and full width, settings behind one `<details>`, warnings only when they say
something actionable (B548/B549); reordering by button and a hero photograph,
both in (B504/B513); `localStorage` persistence, already B511's answer.

So the spec in `docs/superpowers/specs/2026-09-06-photobook-mobile-composer-design.md`
is mostly a retrospective record of those decisions, checked against the
running code and against a real browser at 390px (`example/parks-2025`,
Playwright, `next dev`) rather than a plan for new code. Per-day captions were
considered and left out — a caption is content, not geometry, and the day's
own prose already carries it; adding a second, composer-local text field would
be exactly the page-editor line this ticket asked not to cross.

**The one real gap verification found:** the acceptance line "an arrangement
survives the tab closing" did not hold on reload, reliably, under `next dev` —
a stale-closure race between the restore and persist effects (a `useRef`
guard flipping true before the state it depended on had landed), only visible
under React's Strict Mode development-only double-effect invocation. `next
build && next start` never showed it. Fixed by moving both effects into a
shared `usePersistedState` hook
(`app/[user]/(trip)/photobook/usePersistedState.ts`) gated by state instead of
a ref, verified across three consecutive reloads in a real browser under
`next dev`, and covered by `test/photobook-persistence.test.tsx` (checked by
hand to fail against the old ref-guarded version).

B603 captures the general lesson for `test-in-a-browser`: a finding that only
shows under `next dev` needs a production-build check before it is reported
either way, because Strict Mode's double invocation can make dev and
production honestly disagree about an effect-ordering bug.

**Unverified assumptions**, since this was written from the code and one
browser session rather than a person using the thing: whether the button-based
reorder (rather than drag) actually feels right on a real phone in a hand
rather than in Playwright; whether the level-2 drill-in's "back returns to
where you were" claim (the strip kept mounted with `hidden` rather than
unmounted) holds across a longer session; and everything about the drawn
travellers, which is B506's other half and untouched here.
