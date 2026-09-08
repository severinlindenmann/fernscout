---
id: B954
title: A vague reference to a day builds a ready-to-press overwrite of a different day
type: SECURITY
priority: high
complexity: medium
area: helper, tools
found: "2026-09-08T11:33:51Z"
started: "2026-09-08T11:41:33Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T11:41:33Z"
---

# B954 — A vague reference to a day builds a ready-to-press overwrite of a different day

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`resolveDay` in `lib/helper/tools.ts` ends with the newest entry when nothing
else matches:

```ts
const newest = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0];
return newest ? { trip, entry: newest } : null;
```

That is `resolveTrip`'s `?? trips[0]`, which B940 removed one level up and did
not remove here. At one or two days it is invisible. At fifteen it is a way to
lose work.

Somebody writing up a three-week trip months later, from fragments, said **"the
last one"**, meaning the flight home. There was no day for it yet. The
conversation resolved it to the Alhambra day — the most recently written draft
— and built a filled-in, confidently worded proposal to **overwrite that day's
words** with the flight-home narrative. They caught it before pressing.

Then **"the rainy one"**, about a Barcelona day never mentioned before,
resolved to the existing Seville day, again as a ready-to-press overwrite.

The behaviour is not even consistent, which is what makes it untrappable: *"the
day we got to the coast"*, equally vague, produced a clarifying question. Same
situation, sometimes it asks and sometimes it guesses, and nothing tells a
person in advance which they are getting.

Their own summing up: *"the exact persona this test used — patient, easily
lost, working from fragments months later — is the one most likely to press it
without cross-checking dates."*

Filed as SECURITY rather than ISSUE because the outcome is a person's own
writing destroyed by a press they were invited to make. Nothing here is an
attacker; the loss is the same.

## Work

Take the fallback out, as B940 did for trips, and see what needs to replace it:
`resolveDay` answers reads as well as writes, and "the newest day" is a
reasonable default for *"what have I got"* and a dangerous one for
*"rewrite it"*. That distinction is the work — a read may guess, a write that
overwrites must not.

`set_day_words` is the one that overwrites. `add_cost`, `publish_day` and
`unpublish_day` are additive or reversible, and B951's `refuse` is how a tool
declines with its own sentence.

Not doing: a confirmation dialog. The proposal *is* the confirmation, and the
fault is that it named the wrong day confidently.

## Acceptance

A journal with several days, a request naming none of them, and no proposal to
overwrite anything. "The newest day" as an explicit default stays available
where the person actually said so.
