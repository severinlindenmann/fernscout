---
id: B1576
title: Tapping a choose-block option fills the field and raises the keyboard instead of sending
type: ISSUE
priority: medium
complexity: low
area: agent room, mobile
found: "2026-09-12T08:54:29Z"
started: "2026-09-12T09:24:00Z"
merged: "2026-09-12T09:29:32Z"
---

# B1576 — Tapping a choose-block option fills the field and raises the keyboard instead of sending

## Why

Reported directly: tapping a pre-defined answer/option button in the chat
opens the on-screen keyboard rather than directly sending the choice back to
the agent.

Two different chip mechanisms exist in `components/HelperAsk.tsx`, and they
disagree with each other:

- `RoomOpening`'s opening chips, and the `agent.about.*` chips
  (`HelperAsk.tsx:1140-1152`), go through `go()` (`HelperAsk.tsx:1066-1074`),
  which — when consented — calls `ask(words)` directly. No field write, no
  focus, no keyboard.
- A `choose` block's rows (`ChooseBlock`, `HelperAsk.tsx:1548-1605`) — the
  block a day picker, a trip picker or any other "pick one of these" turn
  renders as — call `onChoose`, wired at `HelperAsk.tsx:1240-1243`:

  ```
  onChoose={(label) => {
    setSaid(label);
    box.current?.focus();
  }}
  ```

  This fills the composer with the option's label and explicitly focuses the
  field — which is exactly what raises a phone's on-screen keyboard, since a
  synthetic `.focus()` inside a real click handler is treated as user-
  initiated. The comment at `HelperAsk.tsx:622-626` documents this as
  deliberate ("the `choose` chips, which call the same `.focus()` from inside
  their own click handler"), but the person's report says this reads as a
  keyboard popping up for no reason rather than an intentional "review before
  sending" step — `choose` options are already the tool's own exact label
  (`ChooseBlock`'s own doc comment: "What gets said if the row is pressed is
  unchanged: the tool's own label"), so there is nothing to edit before
  sending in the normal case.

## Work

- `HelperAsk.tsx:1240-1243` — change `onChoose` to send immediately, the same
  way `go()` does for every other chip: call `ask(label)` (or route through
  `go(label)` if consent needs the same check `go()` already makes) instead
  of `setSaid` + `box.current?.focus()`.
- Leave `ChooseBlock` itself unchanged — the row labels, the "show more" cap,
  and `option.href` rows (which navigate rather than send, B1022) are correct
  as they are; only what a plain option row does on press changes.
- Not doing: removing the ability to review/edit a choice before sending —
  nothing in the report asked for that, and every other chip in this file
  already sends immediately without offering it.

## Acceptance

- On a phone-width browser, reach a turn that renders a `choose` block (a day
  picker is the easiest to trigger) and tap an option: the conversation
  advances with that option as the next turn's sentence, and the on-screen
  keyboard never appears.
- `npm run verify` passes.
