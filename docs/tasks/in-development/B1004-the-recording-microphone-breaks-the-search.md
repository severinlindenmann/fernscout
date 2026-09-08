---
id: B1004
title: The recording microphone breaks the search field's layout, and moving the mouse off it ends the recording
type: ISSUE
priority: high
complexity: low
area: search, speech
found: "2026-09-08T17:37:33Z"
started: "2026-09-08T17:37:51Z"
session: 6c81e17b-6acf-4c0f-86ef-49124c9b2458
claimed: "2026-09-08T17:37:51Z"
---

# B1004 — The recording microphone breaks the search field's layout, and moving the mouse off it ends the recording

## Why

Two faults, reported together with a screenshot of the first.

**1. The field falls apart while it is recording.** `RecordButton`'s compact
form returns a fragment: the button, then its status line ("Hört zu… 1s"), its
screen-reader line and its error. `components/SearchBox.tsx` mounts it inside
the `relative` box that holds the input and the magnifying glass — so those
lines land *inside the field*, the box grows to fit them, and the magnifier,
which is centred with `top-1/2`, drifts to the middle of a box that is now
twice the height of the input. The screenshot shows it pushed below the text.

A component whose compact form is documented as "everything it has to say
rendered in normal flow below the box **by the caller's own container**" was
handed a container that is the box.

**2. Moving the mouse off the microphone ends the recording.** `onPointerLeave:
release`, and `release` stops whenever the press lasted 400ms or more (B995's
`HOLD_MS`). So: click the mic, hold it a beat — which is what a person does —
move the mouse away to speak, and the recording is over before the first word.
Click quickly instead and it toggles and works. That is exactly the reported
"sometimes it works, sometimes it doesn't", and it is worse on a 44px target
in the corner of a text field than on the wizard's full-width bar.

Hold-to-talk is right on the wizard, where speaking is what the step is for
and the thumb is already on the button. In a search field the control is a
toggle: press to start, press to stop.

## Work

- `SearchBox` gives the microphone its own positioned container, so its status
  lines flow **below** the field and the field's own box holds nothing but the
  icon, the input and the button.
- `RecordButton` takes `hold={false}` — the pointer handlers become a plain
  toggle, `onPointerLeave` stops nothing, and the button says "press again to
  stop" rather than "hold". The wizard passes nothing and is unchanged.
- A test for each: the field's box has no status line in it, and a
  `pointerleave` after a long press does not stop a toggle recording.

## Acceptance

- Recording on `/<user>/search`: the field keeps its shape, the elapsed line
  is under it, and moving the pointer anywhere does not end the recording.
- The wizard still holds to talk and still releases on leave.
