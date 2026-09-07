---
id: B762
title: The envelope leaves from the panel's corner instead of from the button, and the panel clips its flight
type: ISSUE
priority: medium
complexity: low
area: auth, ui, motion
found: "2026-09-07T16:05:00Z"
started: "2026-09-07T13:58:55Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T13:58:55Z"
---

# B762 — The envelope leaves from the panel's corner instead of from the button, and the panel clips its flight

## Why

The owner, on B753 as shipped: *"the letter animation is nice but a bit
misplaced or not working as intended — it is like in the top corner of the
field, but it should rather go away from the button, no?"*

Right on both counts, and it is two faults in one line.

**It is anchored to the wrong thing.** `components/EnvelopeFly.tsx` positions
itself `absolute right-4 top-4`, and the nearest positioned ancestor is the
whole sign-in `<section>` (`components/IdentitySignIn.tsx:118`, which carries
`relative`). So the envelope always starts in the top-right corner of the
panel — above the heading, nowhere near the button that was just pressed. The
gesture only reads as "this is leaving because I pressed that" if it starts at
the thing pressed.

**And the panel clips it.** That same section carries `overflow-hidden`, so
the flight up and to the right is cut off at the panel's edge partway through
rather than carrying away. Combined with the wrong origin, what a person
actually sees is a small envelope appearing in a corner and being trimmed.

## Work

- Anchor the flight to the button. Wrap the submit button in its own
  `relative` container and position the envelope against that, so it starts
  over the button and leaves from there. The button is full width, so starting
  near its centre and flying up and away reads better than starting at an edge.
- Let it leave. `overflow-hidden` on the section is what trims it — either drop
  it (check why it is there first; the panel is `rounded-2xl`, so it may be
  guarding a corner) or give the envelope a container that does not clip.
- **Raw hex must go while this file is open.** `EnvelopeFly.tsx` hardcodes
  `#fffaf0`, `#1e293b`, `#c2334a` and `#3fa9c4` — cream-50, navy-900, coral-600
  and sky-500. `apply-the-brand` says tokens, never a raw hex, and B733's
  acceptance said the same; this slipped in because it is an SVG rather than a
  class. Use `var(--color-…)`.

Not doing: changing the flight's timing, its shape, or the reduced-motion
behaviour. Those are right — this is only where it starts and whether it is
allowed to finish.

## Acceptance

- The envelope starts over the "Send me a code" button and leaves from there.
- Nothing clips it partway.
- No raw hex remains in `components/EnvelopeFly.tsx`.
- Still skipped entirely under `prefers-reduced-motion: reduce`, and a failed
  send still shows its error with nothing flying over it.
- Checked at 390px, mid-flight.
