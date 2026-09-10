---
id: B1274
title: One press of the preview publish button fires three requests and stacks three identical publish cards
type: ISSUE
priority: high
complexity: low
area: helper, mobile
found: "2026-09-10T10:23:02Z"
---

# B1274 — One press of the preview publish button fires three requests and stacks three identical publish cards
## Why

Reproduced twice on fernscout.ch at 390x844, 2026-09-10, by patching
`window.fetch` and pressing **Put this day on the site** in the preview pane's
header exactly once:

```
["POST /api/helper/test-mobile/proposal",
 "POST /api/helper/test-mobile/proposal",
 "POST /api/helper/test-mobile/proposal"]
```

Three requests from one press, both times. The result is in the room: after two
presses it held **three** publish cards, each with its own live **Put it on the
site** button, and the phrase "Read it as your readers will see it" appeared six
times in the transcript.

Three identical cards offering the same irreversible decision is bad on any
screen and worse on a phone, where they are three screenfuls apart and look like
three different days until you read them. It also means whatever work
`/proposal` does — a model call, at minimum a round trip — is done three times
for one tap.

`/proposal` happens to be safe to repeat. That is luck, not design: the same
handler shape on a route that spends a credit or writes a day would spend it
three times.

## Work

- Find why the handler runs three times. A press that fires exactly N times is
  usually a listener attached on each render, or one control nested inside
  another that also handles the event — not a race.
- Guard the control while a proposal is in flight, so a double tap on a phone
  cannot queue a second either.
- Check the room's other card-opening controls for the same shape before
  concluding it is one button.

## Acceptance

- One press produces exactly one `POST /api/helper/<user>/proposal`.
- One press produces exactly one card in the room.
- Pressing twice quickly still produces one in-flight proposal.
