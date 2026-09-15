---
id: B1760
title: A date and a place on a journal with one matching trip is not really a choice for a model
type: FEATURE
priority: high
complexity: medium
area: helper
found: "2026-09-15T05:34:22Z"
---

# B1760 — A date and a place on a journal with one trip is not really a choice

## Why

The channel's core flow fails by *choosing*: given "3.6 eger burg den ganzen
tag sehr heiss" on a journal with exactly one trip covering 3 June, the model
has to pick an area, then a tool, then resolve a trip and a date — and the
transcripts show it offering to create a second trip, asking what today's date
is, and in one case reading a place name as a date (B1764).

But almost none of that is genuinely ambiguous. The date is in the message.
Exactly one trip contains it. No day exists for it yet. Those are facts a
function can establish before any model is asked anything.

Three attempts to make the model choose better have all come back
unmeasurable (B1752). This is the other direction: take the choice away.

## Work

- A deterministic resolution step, before the area pick: parse a date from the
  message where one is plainly there, find the trips that contain it, and —
  **only when exactly one does** — carry trip and date as resolved facts into
  the turn.
- It resolves; it never proposes and never writes. Ambiguity stays with the
  model: two matching trips, no date, a date outside every trip all fall
  through untouched, exactly as today.
- Beware the shape B889 warned about — a registry of rows can only answer what
  somebody wrote a row for. This must stay a *resolver*, not an intent
  detector: no keyword lists, no "if it looks like a day".

## Acceptance

- Unit tests for the resolver itself: one trip, two trips, no trip, no date, a
  date outside the trip. Deterministic, in the ordinary suite.
- Then the bench, paired against a baseline. The resolver earns its place on
  the unit tests either way; the bench says whether it helped the conversation.
