---
id: B1836
title: The telling flow's screens cannot be looked at without a live microphone
type: CHORE
priority: medium
complexity: medium
area: testing, benches
found: "2026-09-17T05:27:06Z"
---

# B1836 — The telling flow's screens cannot be looked at without a live microphone

## Why

S7a (the question), S7b (Check the wording) and S7c (one more, if you like) can
only be reached by completing a real recording, and a recording needs
`getUserMedia` plus a working `MediaRecorder`. Headless Chrome with
`--use-fake-device-for-media-stream` gets as far as a trusted press on the
microphone and no further: the button stays on "Tap to speak", no stream
starts, and the screens behind it are unreachable. Confirmed over a full CDP
walk during B1834 — seeded run, real cookies, real photographs, trusted
`Input.dispatchMouseEvent` — which reached the question card and stopped there.

So the most delicate screen in the import — the one whose whole job is stopping
a misheard place name reaching a published sentence — has never been seen by
anything except a person holding a phone. B1834 was a bug on that screen found
by the owner, not by us, and a fix for it could only be proven by a component
test.

This repository already has the answer to exactly this problem: `/docs/branding`
renders real components with props you hand it, above any journal, database,
session or capability, and `check-a-drawing` is the skill that says to go there
rather than editing a constant and screenshotting.

## Work

Add a bench for the telling flow beside the existing four, rendering
`AskCard`, `CheckWording` and the follow-up chips with props a page hands them:
a transcript with a flagged word, a transcript with none, a long transcript, and
the editing state open. `CheckWording` already takes everything it needs as
props and holds no fetch of its own, so nothing has to be faked.

Add the row to `check-a-drawing`'s table so the next person looking at a
complaint about this screen is sent to the bench.

## Acceptance

- `/docs/branding/<name>` renders the telling flow's screens with no journal,
  no session and no capability enabled.
- Both the flagged and the unflagged transcript states are reachable there.
- `check-a-drawing`'s table names it.
