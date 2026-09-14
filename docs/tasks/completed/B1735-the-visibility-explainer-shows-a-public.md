---
id: B1735
title: The visibility explainer shows a Public badge on a Guests trip, and its ? sits below the badge
type: ISSUE
priority: medium
complexity: low
area: Visibility badge
found: "2026-09-14T13:15:12Z"
started: "2026-09-14T13:15:32Z"
merged: "2026-09-14T15:54:58Z"
completed: "2026-09-14T16:33:08Z"
---

# B1735 — The visibility explainer shows a Public badge on a Guests trip, and its ? sits below the badge

## Why

Reported with a screenshot of a trip whose badge reads **Guests**. Opening the
`?` beside it shows the pale example badge reading **Public**. The sentence
next to it says "Pale means nothing was set here: it follows whatever the trip
says" — so the reader sees the word *Public* attached to an explanation of
their *Guests* trip and has to work out whether something is public after all.
The example should wear the word this thing actually shows.

In the same screenshot the `?` sits visibly lower than the badge it belongs
to. Both triggers are `h-11` inline-flex boxes, but they align on the outer
line's baseline and their inner text differs (badge is `font-display`, the `?`
is the body font), so the two baselines land at different heights.

## Work

`components/Visibility.tsx` — `VisibilityHelp` hard-codes
`<VisibilityBadge audience="public" inherited="trip" />`; take the audience
from the control that renders it. `TRIGGER` aligns on the baseline; align the
two triggers by their middles instead.

## Acceptance

- On a Guests trip, the `?` explainer's pale example badge reads *Guests*.
- The `?` and the badge are vertically centred on each other, at desktop and
  phone width, checked in a browser.
