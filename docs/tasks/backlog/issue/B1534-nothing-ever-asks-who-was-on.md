---
id: B1534
title: Nothing ever asks who was on the trip, so people stays empty and the journal has one byline
type: ISSUE
priority: medium
complexity: low
area: helper, content
found: "2026-09-11T21:25:00Z"
---

# B1534 — Nothing ever asks who was on the trip, so people stays empty and the journal has one byline

## Why

Raised by an owner on 2026-09-11, after a 23-day trip was fully published:

> the people on this trip did not get asked, i was on this trip me Sevi + Viki
> so you should have asked me for another person or buddies or something — even
> so, if you see on the pictures there are at least 1 other person

They are right, and the photographs make it plain: 177 of them, two people in
most, and the agent had looked closely enough at two of them to describe both
for the `travellers` figures. It built a party of two and never asked who the
second person was.

`fernscout-helper`'s `icloud-export/SKILL.md` has a four-question interview —
dates, trip name, album, which photos — and **"who was on this trip" is not one
of them.** Step 7 lists what to offer afterwards: costs, places, more
photographs, anything else that happened. Not people.

`validate-content` does tip it, with a good explanation and a warning about
inferring addresses. It arrives as one line among 247 tips on a run reporting
zero errors, at the end of a job that already looks finished.

So the field stays empty, and:

- **the byline is wrong.** The trip says "Geschrieben von Severin" for a trip
  two people were on.
- **the second traveller cannot be tied to their figure.** `travellers[].for`
  takes an address from `people:`; with `people:` empty, the figures are
  anonymous shapes.
- **the other person cannot write to the trip.** `people:` is write access —
  that is the actual reason it exists — so the person who was there has no way
  to correct a day about themselves.

The address is the reason this has to be a question and cannot be a default.
The validator's own tip is blunt about it:

> **Never infer an address.** An agent moving a journal onto a server found a
> person with a name and no email and filled in the owner's.

Which is exactly why asking is cheap and guessing is not.

## Work

In `icloud-export/SKILL.md`, add it to the interview in section 2 — the four
questions asked *before* anything is exported, not the offers at the end:

> **Who else was on this trip?** Their name, and an address they own if you
> want them to be able to write to it. `people:` is the byline and it is write
> access; a name with the wrong address is worse than a name not listed yet.

Two reasons it belongs at the start rather than the end: the answer shapes the
`travellers` block, which is written at build time; and a person who is asked
while looking at their own holiday photographs remembers who was there, whereas
a person being handed a finished journal has already moved on.

`trip-budget`'s SKILL.md is the model for the tone — it asks rather than waits,
for exactly the same reason: the big lines are the ones nobody thinks to
mention.

## Acceptance

- The `icloud-export` interview asks who was on the trip.
- The answer reaches `people:` in `trip.md`, and `travellers[].for` where an
  address was given.
- No address is ever written that the person did not state.
