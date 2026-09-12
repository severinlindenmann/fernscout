---
id: B1591
title: The visibility badge's explainer and its chooser both push the page open instead of floating above it
type: FEATURE
priority: medium
complexity: medium
area: owner tools, visibility, day page, trip page, /me
found: "2026-09-12T17:05:00Z"
started: "2026-09-12T14:55:30Z"
session: 8ab36c58-f1c6-4425-bad2-8726044a90c9
claimed: "2026-09-12T14:55:30Z"
---

# B1591 — The visibility badge's explainer and its chooser both push the page open instead of floating above it

## Why

B1585 shipped and the author used it. The functions are right; the presentation
is not. Their words, and each is a separate fault:

- *"not aligned"* — the `?` is a bordered circle that wraps onto its own line
  and sits **above** the badge on the day heading, and **below** the select in
  the `/me` trip editor. Two rings, two rows, nothing on one baseline.
- *"if you click the helper it could rather open as a popup instead of moving
  the layout"* — `VisibilityHelp` is a `<details>`, so opening it inserts a
  panel into the flow and shoves everything below it down.
- *"the same for the option button to change it"* — worse there. The open
  control *replaces* the badge, and on the Ungarn trip the date, the byline and
  the "trip is over" card drop about 220px. You lose the place you were
  reading.
- *"does it work that i can press it directly yes? with a bit animation that
  the user knows it presses"* — the badge is a `<button>` and looks like a
  label. No hover state, no press state, nothing saying the open card belongs
  to it.
- *"also add the tag pls to here"*, of the journal card on `/me` — the word is
  only inside the pencil, and the card is where you look.
- *"in ? rather add info Click on the Symbol (the one that is activ) on the
  left and change it (the description is already in the settings)"* — the
  explainer repeats the three sentences that are already beside each option in
  the chooser. It should point at the badge instead, and carry the one fact
  that is nowhere else: what a pale badge means.

Agreed with the author against a clickable mockup, three rounds
(`b1585-design-draft.html`, kept out of the repo — it is a throwaway).

**Two bugs were found in the mockup itself, and both are the shape of thing
that would have shipped.** They are recorded here because the fix is a rule,
not a patch:

1. The `?` kept a 44px tap target by spreading an invisible `::after` around a
   small glyph — and `.help` had no `position` of its own, so that rectangle
   anchored to the nearest positioned ancestor, the whole badge row, and lay on
   top of the badge. Every press on a badge opened the explainer. Playwright
   says it outright: *"`<button class="help">?</button>` intercepts pointer
   events"*. **A trigger must be genuinely the size it claims** — a 44px-tall
   box with small ink inside it — never a small box wearing a large invisible
   one.
2. A popover placed inside a `<p>` does not work at all: the parser closes the
   paragraph at the block-level child, the panel lands outside its anchor, and
   nothing opens. This is the same failure as the `<details>`-inside-`<p>`
   hydration bug B1585 hit on `/me`. **The day badge lives inside an `<h2>`,
   which has the same phrasing-content restriction**, so this is not
   hypothetical.

## Work

All of it in `components/Visibility.tsx` and its two mount points. No route
changes, no server changes, no change to who sees what — every rule B1585
established stands: owner-only always-on badges, everybody else's page exactly
as it was, two presses to change anything.

**The two triggers.** Badge and `?` in one inline row, both 44px tall with the
ink drawn small inside — no invisible overlays, per the bug above. The `?`
loses its border and becomes a quiet grey glyph immediately after the badge.
Press feedback: a soft halo on hover, `scale(.94)` on the badge and `.88` on
the `?` for ~90ms, a yellow ring on the badge while its own card is open, and a
focus-visible ring for the keyboard.

**Both cards float.** Absolutely positioned, arrow, shadow, one open at a time,
closed by Escape and by a click outside. Nothing in the flow moves.

**Markup must be phrasing-safe.** Span-based, or anchored outside the heading.
A `<div>` inside the `<h2>` the day badge sits in is invalid and a `<div>`
inside a `<p>` silently breaks. Prove it with a real click in a browser, not a
programmatic one — a programmatic `.click()` passes straight through the
interception bug that a real pointer hits.

**Narrow screens get a sheet.** The card fits at 390px only when its badge is
near the left edge; a badge further right pushes it off. Below the `sm`
breakpoint it slides up from the bottom as a sheet instead. Author chose this
over edge-flipping.

**The chooser replaces its `<select>` with tappable rows** — one per value,
each with its badge and its one-line meaning, so all of them are readable
without opening anything. `listed` (public) or `teaser` (closed) below a rule,
then the warning, then Cancel and the confirming button. This also removes the
odd two-step where picking from a select made a separate warning box appear
underneath it.

**The `?` becomes a pointer.** "The badge on the left shows who can see this;
tap it to change it — each option explains itself there", then, below a rule,
what a pale badge means. The journal variant keeps its second line, because
journal `guest` meaning *only* "not advertised" is the trap AGENTS.md warns
about and it has nowhere else to live.

**`/me` journal card**: the badge beside the journal's name, in the card
header. **Careful — that name is inside a `<summary>`**, so a control there
toggles the disclosure unless the press is stopped. Verify by clicking it.

**Photographs are unchanged** except that section D of the draft is now
documented: pale is inherited, full strength is decided-here, and a photograph
explicitly set to `guest` is the same word as an inherited one at full opacity.
Weight is the only thing carrying "somebody decided this", deliberately — a
second signal (an outline) was considered and held back until it has been seen
on a real gallery.

Not doing: any change to what a non-owner sees; a control on gallery tiles
(B1585 settled that); edge-flip anchoring.

## Acceptance

As the owner, in a real browser, on a trip that predates the branch:

- Pressing a badge opens its chooser **over** the page — nothing below it
  moves. Same for the `?`.
- Pressing a badge opens the *chooser*, never the explainer. Verified with a
  real pointer click at every mount point: trip hero, day heading, `/me` trip
  editor, `/me` journal card.
- The badge visibly responds to hover, to press, and stays lit while its card
  is open.
- Escape closes; a click outside closes; only one card is ever open.
- At 390px the card is a bottom sheet and the page does not scroll sideways.
- The `?` no longer repeats the option descriptions, and says what pale means.
- The journal's word is on the `/me` card without opening the pencil, and
  pressing it does not toggle the pencil.

`npm run verify` green, including `test/locales.test.ts` and
`test/no-browser-dialogs.test.ts`. Screenshots on disk at 390 and 1280.

## What building it changed

**The popover is portalled, and that turned out to be required rather than
tidy.** `StoryPager` wraps every day in a `motion.div` that animates `y`; a
transform on an ancestor becomes the containing block for `position: fixed`,
so the bottom sheet would have pinned itself to the middle of the day card —
and only while the animation ran. `components/VisibilityPopover.tsx` carries
that, with the phrasing-content and overflow-clipping reasons beside it.

**Two controls collapsed into one, which was not in the Work section.**
Building it made the duplication plain: the journal had a checkbox on `/me`
*and* the new badge, and a trip had the shared control on its own page *and*
a separate `<select>` with its own two-press button in `/me`'s pencil. Both
were the same field with two shapes and two sets of words. `JournalVisibility`
and `TripVisibilityFor` are now the single control in both places — `/me`'s
trip panel writes through `/<user>/trips/<id>/visibility` instead of
`/api/trip`, which is also what gives it `listed` and `teaser`. Every string
the old controls used moved across; none was dropped.

**`TripEditPanel` gained `listed` and `teaser`**, passed from
`app/[user]/me/page.tsx`, because the shared control writes them.

**A test that could not fail, caught by trying to break it.**
`test/me-journal-badge.test.tsx` first asserted `details.open === false` after
pressing the badge — and passed with the `stopPropagation` guard deleted,
because **jsdom does not toggle a disclosure when its summary is clicked**. It
now asserts the click was cancelled, which is the mechanism that stops the
toggle, and it fails when the guard is removed. Verified both ways.

**`VisibilityHelp` renders inside the control**, not at each mount point. The
first cut left it to callers and the trip page silently had no `?` at all —
found in the browser, not by any test.

## Acceptance, as met

Driven with real pointer clicks in Chrome against `alps-2024`, which predates
the branch:

- Badge press opens the *chooser*; the `?` opens the explainer. Both at the
  trip hero, the day heading, `/me`'s trip panel and `/me`'s journal card.
- The dates under the trip hero moved **0px** when either opened.
- Escape closes; a click outside closes.
- At 390px the card is a sheet pinned to the bottom, spanning the full
  viewport width (375px of a 390px window — the rest is the scrollbar), with
  no horizontal page scroll.
- The journal badge inside the `<summary>` opens the chooser and the
  disclosure stays shut.
- A real save round trip: public → Guests → public, landing on disk each time.
- `/me` reports 0 console errors.

Screenshots: `/tmp/b1591-evidence-{sheet-390,help-390,card-1280}.png`.
