---
id: B770
title: The journal header takes four stacked rows on a phone before any content starts
type: FEATURE
priority: high
complexity: medium
area: header, mobile, a11y
found: "2026-09-07T16:15:00Z"
started: "2026-09-07T14:07:48Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T14:07:48Z"
---

# B770 — The journal header takes four stacked rows on a phone before any content starts

## Why

The owner, looking at a real journal on a phone: *"the header for the menu
feels a bit big and not so nice on mobile — rework the header to be more sleek
and UX/UI friendlier."*

This is **J9 in `docs/ROADMAP.md`**, which has been open since W17 and already
names the remedy: *"the top bar takes two rows on a phone… the fix is a mobile
menu behind one button, which is a design decision."* It has got worse than
that entry describes. On a 390px screen the header now stacks **four** rows
before a single word of the journal appears:

1. a back link — "Deine Reisetagebücher"
2. the journal title
3. three chips — the trip switcher, the currency, the language
4. seven navigation icons

J9 measured 121px of sticky header where 61px was intended; four rows is more
again. On a phone that is a quarter of the viewport spent on chrome, above
content this audience came to read — and the same page also carries a fixed
day-navigation bar at the bottom, so the actual reading window is smaller
still.

J9 also records the tap-target problem, which must not survive this rework:
the icons are 36×44. That clears WCAG 2.2's 24px floor and not the 44px this
audience wants — readers past sixty, on a phone, often outdoors.

## Work

**The shape.** One row on a phone: back, the journal's name, and a single menu
button. Everything else — the trip switcher, currency, language, and the seven
destinations — moves behind that button into a panel. The current arrangement
stays at `sm:` and up, where it fits and is good.

Two things to get right rather than assume:

- **Say where you are.** Collapsing seven icons into one button loses the
  current section, which the highlighted icon is carrying today. The row has
  space for it once the chips are gone — the section's name beside the
  journal's is the obvious answer, but decide it deliberately.
- **The bottom bar is taken.** A bottom tab bar is the phone-native answer and
  is not available: the day pages already carry a fixed bottom navigator
  ("Basel · 22 Jun · Tag 1 von 9 · Weiter →"). Two fixed bars would leave
  almost nothing. This is why the menu goes in the top row.

**The panel.** Not a `window.confirm`, not a browser dialog — B633 and B668
are emphatic and `test/no-browser-dialogs.test.ts` enforces it. A panel in the
flow, dismissible with Escape and by tapping outside, focus moved into it on
open and returned to the button on close, and every row in it at least 44px
tall.

**Keep the brand.** `apply-the-brand`: tokens only, six hues, `yellow-600` is
never text on cream, focus stays `blue-500`. The header currently marks the
active section with a `yellow-400` disc — whatever replaces it should still
read as the waymark rather than as a new idiom.

Not doing: the bottom day-navigator, the desktop header, or any change to what
the destinations are. This is the arrangement on a phone and nothing else.

## Acceptance

- At 390px the header is one row, and its height is at most half what it is
  today. State the before and after in pixels, measured.
- Every interactive thing in the header and the panel is ≥44px.
- The current section is identifiable without opening the panel.
- The panel opens and closes by keyboard alone, Escape closes it, and focus
  returns to the button.
- No browser dialog. `test/no-browser-dialogs.test.ts` still passes.
- Checked on a day page (which also has the bottom bar), the trips index, and
  the gallery — at 390px.
- `docs/ROADMAP.md` J9 is updated to say it is done, or why it is not.
