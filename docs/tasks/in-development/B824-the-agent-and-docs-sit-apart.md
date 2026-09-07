---
id: B824
title: The agent and docs sit apart from the destinations they are listed with
type: ISSUE
priority: medium
complexity: low
area: header, nav
found: "2026-09-07T17:40:00Z"
started: "2026-09-07T15:37:13Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T15:37:13Z"
---

# B824 — The agent and docs sit apart from the destinations they are listed with

## Why

Asked for, having seen B797 running: *"move the agent above Reise and Doku as
an icon next to the icons."*

B797 put the agent in the menu panel as a full-width navy call to action with
the docs link under it, above a rule, above the chips, above the seven
destinations. That was built to the brief at the time — *"the Agent must be
big, feeling like a call to action to press it"* — and seeing it in place has
changed the answer: in a panel that is otherwise a clean list of icon-and-word
rows, two differently-shaped controls at the top read as a banner stuck above
the menu rather than as part of it.

This supersedes that half of B797's arrangement. It is not a reversal of the
decision that matters — the agent still leads from the header on every page,
which is what B797 was for; it is where it sits inside the panel.

## Work

- Agent and Doku become rows in the destination list, with icons, in the same
  shape as Reise/Galerie/Karte — **above** Reise.
- The separate navy pill, the docs link beneath it and the rule under them go.
- They are still not ordinary destinations: keep the `helper` gate on the
  agent row (docs stays ungated — B802 is why), and consider whether a hairline
  under the two keeps the distinction without the banner.
- `yellow-400` still means "you are here" and nothing else. An agent row must
  not take the active colour when it is not the active page.
- Every row ≥44px, as the list already is.

## Acceptance

- The panel is one list: Agent, Doku, then the destinations, all the same row
  shape.
- With `helper` off the agent row is absent and Doku is still there.
- The active destination is still the only yellow thing.
- Header height is unchanged at 65px on a phone.
- Checked at 390px.
