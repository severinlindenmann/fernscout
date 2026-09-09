---
id: B1124
title: Sending a message and waiting for an answer has no motion at all
type: FEATURE
priority: high
complexity: low
area: components/HelperAsk.tsx
found: "2026-09-09T17:45:59Z"
started: "2026-09-09T17:49:38Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-09T17:49:38Z"
---

# B1124 — Sending a message and waiting for an answer has no motion at all

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Sending a message and waiting for an answer has no motion at all: the sentence
is there, then some seconds pass, then an answer appears. A wait of several
seconds with nothing moving reads as a failure, and the room's own waits are
several seconds because a model is thinking.

## Work

Two states, and no more.

- **The card assembling** — label, field, field, button, arriving in the order
  they will be read. Used when the tool is already known, because it says what
  kind of answer is coming before it has come, which is the most useful thing a
  wait can do.
- **Three waymark lozenges** — typing dots, but they are the mark. The fallback
  while the shape of the answer is not yet known, with the tool named in a
  line beneath it where the server knows it.

Considered and not building: a message flying up out of the composer (it fights
the keyboard transition on a phone) and a lozenge walking the trail (charming,
uninformative, and a battery cost on every turn).

`prefers-reduced-motion: reduce` removes all of it — not a shorter animation, none.

## Acceptance

A turn that proposes shows the assembling card; a turn that does not shows the
lozenges. With reduced motion set, neither animates and nothing is lost.
