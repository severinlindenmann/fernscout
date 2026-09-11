---
id: B1299
title: A refusal from the trip-people tool appears alone in the transcript during a conversation about costs
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-10T11:13:05Z"
started: "2026-09-11T06:40:33Z"
merged: "2026-09-11T08:13:17Z"
---

# B1299 — A refusal from the trip-people tool appears alone in the transcript during a conversation about costs
## Why

Asked to record two costs — *"The rosti cost 24 francs and the Einstein house was
8 francs each for two of us"* — the room produced two correct cost cards, and
between them and the model's summary printed this, alone, with no card attached:

> I need their name and their email address before I can put this in front of
> you — say both and I will make the card.

That is `agent.tool.tripPeopleNeedsEmail` — the refusal from the *add somebody to
the trip* tool, which the model evidently called while working out who the "two of
us" were. Its refusal is rendered into the transcript as though it were a message
to the reader.

Nothing on screen connects it to anything. Read in place it says the room is
asking for somebody's name and email address in order to record a restaurant bill,
which is both alarming and untrue — the costs were proposed correctly and no
person was needed.

The costs themselves are good: 24 CHF and 16 CHF, the second correctly doubled
from "8 francs each for two of us", with no invention.

## Work

- A tool refusal that the model recovers from should not be rendered as a turn.
  Decide which tool results are for the reader and which are for the model, and
  render only the first.
- Check the other `agent.tool.*needs*` strings for the same exposure — they are
  all phrased as messages to a person, which is what makes them look like ones.

## Acceptance

- A turn in which the model calls a tool, is refused, and proceeds successfully
  shows no orphaned refusal in the transcript.
