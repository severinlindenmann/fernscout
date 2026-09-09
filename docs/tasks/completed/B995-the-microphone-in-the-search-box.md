---
id: B995
title: The microphone in the search box listens and never sends what it heard
type: ISSUE
priority: high
complexity: low
area: search, speech
found: "2026-09-08T17:09:27Z"
merged: "2026-09-08T17:11:44Z"
completed: "2026-09-09T16:47:23Z"
---

# B995 — The microphone in the search box listens and never sends what it heard

## Why

Reported: the microphone inside the search field on `/<user>/search` "does
nothing". It shows "Listening… 7s", and no words ever arrive.

`components/RecordButton.tsx` treated every press as a hold, and two things
followed from that:

1. **The pointer leaving the button ended the recording.** You click the
   microphone and then move the mouse away to speak — `onPointerLeave: stop`
   fires a fraction of a second in, and a recording under half a second is
   dropped by `onstop` without being sent. So: listening, then nothing.
2. **A click could not end a recording either.** `pointerup` arrives about
   forty milliseconds after `pointerdown`, while `start()` is still awaiting
   `getUserMedia`; `stop()` found `recorder.current` null, did nothing, and
   the recording began afterwards with nothing left to stop it.

And the drop itself was silent, which is what made both invisible: a
half-second recording was discarded with no sentence anywhere on the screen.

## Work

- A short press is a toggle (start, then stop on the next press); a long one
  is still a hold that ends on release.
- A stop asked for before the microphone was granted is honoured when it is.
- Say something when a recording is too short to send.
- `test/record-button-press.test.tsx` pins all three.

## Acceptance

Click the microphone on the search page, move the mouse away, speak, click
again: the sentence goes to the agent. A click and an immediate second click
says the recording was too short rather than nothing at all.
