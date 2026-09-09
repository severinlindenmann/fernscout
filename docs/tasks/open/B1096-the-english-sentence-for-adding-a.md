---
id: B1096
title: The English sentence for adding a person to a trip says 'not just this' and does not say what this is
type: ISSUE
priority: low
complexity: low
area: site/locales/en.json
found: "2026-09-09T16:17:50Z"
---

# B1096 — The English sentence for adding a person to a trip says 'not just this' and does not say what this is

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`agent.tool.tripPeople` is the sentence on the card that adds somebody to a
trip, and adding somebody to `people:` grants them **write access to the whole
trip**. That is the one thing the sentence has to make unmissable.

The three locales say different things:

- en — "{name} joins the byline of {trip} — and can then write to the whole
  trip, not just this."
- de — "… und kann danach an der ganzen Reise mitschreiben, **nicht nur daran
  lesen**."
- hu — "… és ezután az egész utazáshoz írhat, **nemcsak olvashatja**."

German and Hungarian both say *not just read it*, which is the actual contrast
and the reason the sentence exists. English says "not just this", and never
says what *this* is — a reader can plausibly take it as "not just this day",
which is a different and much smaller claim than the one being granted.

Found by reading the shipped strings while writing up the run, not by anybody
using it. Low priority because the first clause is correct on its own; it is
here because a grant sentence is the wrong place for a vague word.

## Work

Rewrite the English to say what the other two say. Something of the shape
"… and can then write to the whole trip, not only read it." One key, one file,
then `npm run i18n:keys` is not even needed — the key already exists.

## Acceptance

The English sentence names what the person could do before and can do now,
with no bare "this".
