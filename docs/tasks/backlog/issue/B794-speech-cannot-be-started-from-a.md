---
id: B794
title: Speech cannot be started from a keyboard at all
type: ISSUE
priority: high
complexity: low
area: agent, a11y
found: "2026-09-07T14:55:04Z"
---

# B794 — Speech cannot be started from a keyboard at all

## Why

`components/RecordButton.tsx:240-249` wires the record button with pointer
events and nothing else:

```jsx
const hold = {
  onPointerDown: () => { setSpeaking(true); … },
  onPointerUp: stop,
  onPointerLeave: stop,
  onPointerCancel: stop,
};
```

Keyboard activation of a `<button>` fires `click`, never `pointerdown`. So with
a keyboard — which is how a screen-reader user drives a page — **the microphone
cannot be pressed, held or released. Nothing happens at all.**

The feature built specifically for somebody who does not want to type is the
one feature a keyboard user cannot reach. Found by a blind tester auditing the
live site on 2026-09-07.

On iOS, VoiceOver's double-tap-and-hold can dispatch a held pointer sequence,
so it is marginally reachable there — but nothing tells a VoiceOver user that a
*hold* is required rather than the usual double-tap, and the accessible name
("Sprechen") does not say so.

Two smaller faults in the same component:

- While recording, the elapsed-time `role="status"` (`:315-319`) is rewritten
  on a **200 ms timer** (`:113-121`). That is far faster than any screen
  reader's live-region cadence: it will either flood the listener or be
  dropped mid-word. Announce on a slower cadence, or not at all.
- The accessible name says nothing about the interaction model.

## Work

Give the button a keyboard path: a plain `onClick` that **toggles** recording —
start on the first press, stop on the second — kept alongside the pointer-hold
for touch and mouse. Two interaction models on one control is the standard
answer here and is what a native dictation button does.

Say in the accessible name what the control does: press to start, press again
to stop; hold to talk.

Slow or drop the elapsed-time announcement.

## Acceptance

A keyboard-only user can record, stop, and get their words into the day. A
screen reader announces that recording started and stopped, once each.
