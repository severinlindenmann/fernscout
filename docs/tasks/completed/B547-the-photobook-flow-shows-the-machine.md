---
id: B547
title: The photobook flow shows the machine's reasoning instead of the book
type: FEATURE
priority: high
complexity: high
area: photobook, composer, ux
found: "2026-09-06T09:03:48Z"
merged: "2026-09-06T09:38:42Z"
completed: "2026-09-07T13:11:51Z"
---

# B547 — The photobook flow shows the machine's reasoning instead of the book

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The composer was reviewed by the person it is for, at 390px, and the verdict was
that it is not intuitive and does not really work. Looking at it rather than at
its tests, that is correct, and the fault is not a missing feature. **It is a
debug console with a Pay button.**

What is actually on the screen:

- **Nine configuration decisions before anything is visible.** Format, cover,
  language, binding and five `Include the …` checkboxes fill the first screen
  and a half. The book is below all of it, and when you reach it it is inside a
  **small scrollable letterbox** you scroll within. The thing being made is the
  smallest element on the page.
- **Machine codes as user-facing headings:** `no-original`, `blank-padding`,
  `low-resolution`.
- **A source identifier and repository path shown to a customer:** "A trip this
  short wants saddle stitch (4-48 pages) rather than perfect binding — see
  `SADDLE_STITCH` in `lib/photobook/spec.ts`."
- **Internal media paths:**
  `example/trips/usa-2026/media/denver-and-a-truck/01.jpg, …`.
- **Printer's vocabulary as the primary language:** perfect bound, saddle
  stitch, bleed, trim, recto, 300 DPI target, spine 1.8 mm.
- `1 volume(s)`, `16 warning(s)`.
- **The warnings block is physically larger than the book preview.**
- In the day view the per-photograph controls are three unlabelled glyphs:
  `‹ ★ ›`.

B534 split this into two levels, and the hierarchy was right — the research
behind it still holds. What B534 did not question is that *both* levels are
full of the planner's diagnostics. Rearranging the furniture did not help
because the furniture was never the problem.

### The warning that gives away the whole design

One of them reads: *"A trip this short wants saddle stitch rather than perfect
binding."*

**The software already knows the right answer.** Rather than applying it, or
offering it, it prints a paragraph instructing the reader to go and find a
radio button — and names a constant in a source file while doing so. That is
the product upside-down, and it is the single clearest statement of what is
wrong: this page explains its reasoning where it should be acting on it.

### The principle

**The book is the interface.** Everything else is secondary and is reached from
it. The planner's arrangement is good — that is what makes this fixable — so the
default path is *look at the book, order the book*, and every control is a way
of disagreeing with a decision that has already been made well.

## Work

Four children, filed separately: B548 (the first screen), B549 (warnings),
B550 (the day view), B551 (the order and what follows it). This ticket is the
argument they share and closes when they do.

**Not doing: a new dependency.** Paged.js, Vivliostyle and
`@react-pdf/renderer` were all considered. They generate print-ready PDF from
HTML/CSS and none of them make an editor friendlier — the problem is what we
chose to put on the screen. See B552 for the one structurally interesting idea
that came out of that search, kept separate because it is not this.

**Not doing: touching the planner.** `lib/photobook/plan.ts` decides what goes
on which page and it decides well. This is the layer above it.

## Acceptance

- A person opening the composer sees the book before they see a form control.
- No machine code, file path, repository symbol or measurement in millimetres
  appears anywhere a customer reads, unless they asked for it.
- Where the software knows the remedy, it offers the remedy rather than
  describing the problem.
- The nine settings are still reachable — this is not about removing choice, it
  is about not demanding it up front.
