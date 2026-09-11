---
id: B1256
title: Every card outcome is announced twice, once by the card and once by the model
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-10T09:57:28Z"
started: "2026-09-11T06:40:32Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T06:40:32Z"
---

# B1256 — Every card outcome is announced twice, once by the card and once by the model
## Why

Each of the helper's cards reports its own outcome, and then the model says the
same thing again a few lines later. Three in one short session on fernscout.ch,
2026-09-10:

| Card | Printed |
| --- | --- |
| start the day | "The day is started. It is a draft, so nobody but you can read it." **twice** |
| write it up | "That is what it made of your notes. Nothing is saved yet." **twice** |
| save the words | "The words are saved." **twice** |

They are two different elements — the card's own result line
(`p.mt-2.text-sm.text-navy-600`) and the model's reply (a `span`) — roughly 190px
apart, usually with an unrelated sentence between them, so on a phone they arrive
as two separate screenfuls saying the same thing.

The cost is not only noise. Every repetition makes the transcript longer on the
screen where length is most expensive, and a person reading two confirmations of
one action reasonably wonders whether it happened twice — which, for "the words
are saved" on a journal, is a real question rather than a stylistic one.

## Work

- Decide which half owns the confirmation. The card knows what it did and cannot
  be wrong about it; the model's sentence is the one that can (which is what
  `lib/helper/model.ts` guards). Keeping the card's line and letting the model
  move the conversation on is the smaller change and the safer one.
- Whatever is chosen, the model should not be *required* to restate an outcome
  in order to satisfy a guard — check `lib/helper/model.ts` before removing the
  sentence, in case a check depends on it being said.

## Acceptance

- Starting a day, writing it up, and saving the words each print one
  confirmation.
- The guards in `lib/helper/model.ts` still pass — no honest turn is refused for
  not repeating the card.
