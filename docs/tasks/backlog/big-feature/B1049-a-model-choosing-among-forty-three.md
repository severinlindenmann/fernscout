---
id: B1049
title: A model choosing among forty-three tools chooses worse than one choosing among seventeen
type: FEATURE
priority: medium
complexity: high
area: lib/helper/tools, lib/helper/model.ts
found: "2026-09-09T07:08:16Z"
---

# B1049 — A model choosing among forty-three tools chooses worse than one choosing among seventeen

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`lib/helper/tools/` held seventeen tools until 2026-09-09 and holds forty-three
now: a trip's settings and money, who hears about a day, the journal's own
account and keys, printed postcards and photobooks, the inbox. Every one of
them is wanted, and each was built against a route the API door already had.

The cost that is *measured* is tokens, and it is not the problem. 3205 tokens
of prompt against 4372 of tool descriptions — well under a rappen a turn at
Haiku's input price. `test/helper-thread.test.ts` raised its ceiling to 8000
and said so in a paragraph.

The cost that is **not measured** is choosing. A model handed forty-three tools
picks the wrong one more often than a model handed seventeen, and nothing in
this repository would notice: every test drives a tool by name. The failure
would arrive as a person being shown a proposal for something they did not ask
for, which is the one thing `lib/helper/model.ts`'s net is least able to catch
— the sentence is true about the turn, the turn is just the wrong turn.

## Work

Two halves, and the first is the one that matters.

**Find out whether it is real.** There is no evidence either way yet. Drive the
room with `test-with-personas` against a list of sentences whose right tool is
known, before and after, and count. If forty-three tools pick as well as
seventeen did, this ticket is a `wontDo` and the paragraph in the ceiling test
should say so.

**If it is real, group rather than trim.** The shape to reach for is a small
first-level list — days, trips, money, readers, files, the journal, printed
things — where choosing an area returns that area's tools, so the model chooses
twice among seven rather than once among forty-three. `lib/helper/tools/areas/`
is already that partition, which is why it is the cheap version. Not doing:
cutting a tool, shortening a `describe` (the ceiling test rules that out for
good reason), or a second model to route between them.

## Acceptance

A written count, from real turns, of right-tool-chosen before and after. That
is the whole of it — a change made without one is a guess.
