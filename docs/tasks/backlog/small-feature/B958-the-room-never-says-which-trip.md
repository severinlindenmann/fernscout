---
id: B958
title: The room never says which trip or which day is being talked about
type: FEATURE
priority: medium
complexity: medium
area: helper, ui
found: "2026-09-08T12:07:44Z"
---

# B958 — The room never says which trip or which day is being talked about

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The other half of B947, split off because it is a design question and the two
things it names are one question.

A designer on a laptop:

- The preview pane opens on *"Reading the day…"*, tracks whatever date was last
  mentioned, and offers no control. A first-time reader has no way to know what
  would make it resolve.
- Nothing says where you are. No trip named above the conversation, no list to
  switch between. Every reference to "the day" lives in the text of the
  conversation, and there is nothing to click. With several trips this gets
  confusing quickly.

Both are *"the room has no persistent sense of what is under discussion"*, and
the volume test made it sharper: somebody writing up fifteen days out of order
said "the last one" and "the rainy one" meaning days that did not exist, and
had no way to see which day the conversation had settled on except by reading
the proposal's fields.

## Work

Design it rather than patch it. A picker bolted onto the preview would answer
the symptom and break the user's own rule — everything here is done by
talking, and a trip switcher is navigation.

The likely shape is a line that says what the conversation is currently about,
derived from the same signal the preview already follows, and readable rather
than operable. Worth drawing before building.

Not doing: navigation, a trip list, or a second way to choose a day.

## Acceptance

At 1440px and at 390px, a person can see which trip and which day the
conversation is about without reading the conversation back.
