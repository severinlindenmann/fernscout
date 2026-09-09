---
id: B1041
title: The agent asks in prose for what its own card would have asked in controls
type: ISSUE
priority: high
complexity: low
area: helper, model
found: "2026-09-09T04:48:50Z"
merged: "2026-09-09T05:48:24Z"
---

# B1041 — The agent asks in prose for what its own card would have asked in controls

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Pressing **Neue Reise** sends *"Ich möchte eine neue Reise anlegen."* The answer
was a paragraph:

> Ich brauche dafür ein paar Angaben von dir: **Titel**: Wie soll die Reise
> heissen? **Startdatum**: Wann beginnt sie? (YYYY-MM-DD) **Enddatum**: Wann
> endet sie? **Sichtbarkeit** (optional): Wer soll die Reise lesen können —
> alle (öffentlich), nur Gäste deines Journals, oder nur die Personen, die
> mitgereist sind (privat)?

Every one of those is a field on the card `create_trip` would have proposed. It
has a title box, two **date** fields, and a **select** whose three options are
those three sentences as labels — `ProposalField.options` has rendered as a
real dropdown since B900.

So the person was asked to type a date in a format, and to choose a visibility
by describing it back in words, by a tool whose entire purpose is to put a date
picker and a dropdown in front of them.

The owner's reading, and it is the right one: *"stuff like that should be
visual and not coming back as text — like a dropdown selection for private,
guest."*

The prompt already says to call the write tool as soon as the want is
understood, because *the proposal is the confirmation*. It was understood: the
sentence says what it wants. The model asked anyway.

## Work

B829 is the standing warning that rewording the prompt is a weak lever, and
this is the third time that has held. Look for the checkable version instead.
The turn knows what it did: **a person asked for a thing a write tool exists
for, and the turn produced no proposal.** That is the same shape as every other
honesty check — a claim about what is on the screen, checked against what is on
the screen.

A narrower reading, and probably the true one: an answer that asks for values
which are *fields on a tool it did not call* is the fault. That is checkable
without understanding the sentence.

Not doing: filling the fields in for them. An empty card is the point — the
person types into it, and nothing is written until they press.

## Acceptance

"Ich möchte eine neue Reise anlegen" produces a card with a title box, two date
fields and the visibility dropdown, and no paragraph asking for any of them.
