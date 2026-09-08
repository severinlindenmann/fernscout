---
id: B959
title: The trip total is read as a stranger, so money on a draft day is invisible to its own owner
type: ISSUE
priority: high
complexity: low
area: helper, costs
found: "2026-09-08T12:18:38Z"
---

# B959 — The trip total is read as a stranger, so money on a draft day is invisible to its own owner

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`trip_costs` in `lib/helper/tools.ts`:

```ts
const costs = getCostSummary(tripRef(username, trip.id));
```

No `ReadOptions`. Every other read tool in the file passes `AS_AUTHOR`; this one
reads the trip as an anonymous visitor, so **costs on a day that is still a
draft are invisible** — to the owner, in their own conversation, about their
own money.

Found at volume, and it is the write-up case exactly: somebody logging spend as
they write, before publishing. Three times in one session:

- two costs logged, both on drafts: *"the total is 0 CHF because nothing has
  been saved yet"* — both were on disk.
- four logged: *"nothing has been recorded yet… waiting to be pressed"* —
  all four persisted.
- six logged: *"Total for the trip so far: 31 CHF"* — the two on published
  days.

B955 stopped the model doing its own arithmetic and made it call this tool
every time. That was right and it made this worse, in one specific way the
tester put better than I can: *"the original wrong sum looked derived and
second-guessable; this one arrives with the institutional authority of 'I
called the tool that reads it off disk.'"*

## Work

Pass `AS_AUTHOR`, and then look for the same omission in the other direction:
`getCostSummary`'s default is the anonymous reader, which is the right default
for a page and the wrong one for every caller inside the owner's own
conversation.

## Acceptance

A trip with a cost on a draft day and a cost on a published one: the total is
both. And a test that fails if any read tool in the registry reads without
`AS_AUTHOR`.
