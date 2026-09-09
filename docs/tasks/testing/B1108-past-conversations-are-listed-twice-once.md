---
id: B1108
title: Past conversations are listed twice, once as chips and again as prose with unrendered asterisks
type: ISSUE
priority: medium
complexity: low
area: lib/helper/tools/areas/journal.ts
found: "2026-09-09T16:48:03Z"
merged: "2026-09-09T17:58:59Z"
---

# B1108 — Past conversations are listed twice, once as chips and again as prose with unrendered asterisks

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Asking "show me my earlier conversations" on the live site draws the list
**twice**: once as the `choose` block's chips, which is the thing B1022 built,
and then again underneath as a paragraph of the model's own prose repeating
every row — carrying literal `**` around each date, because the answer text is
not rendered as markdown.

So the screen reads:

> [ how many credits do I have left?  2026-09-09 ] [ what invite links do I
> have?  2026-09-09 ] …
>
> Here are your earlier conversations, most recent first: - \*\*2026-09-09
> 16:21\*\* – how many credits do I have left? - \*\*2026-09-09 16:20\*\* – …

The chips are the answer. The paragraph is the same answer, longer, with
punctuation the person was never meant to see.

This is the general shape of a read tool whose block already *is* the answer:
the model says it again in words because nothing tells it not to. Worth
checking whether `invites`, `inbox` and `keys` do the same before fixing only
this one.

## Work

Either the tool's block is the answer and the model says a sentence at most, or
the model answers and there is no block. Not both. The likely lever is the
tool's `describe`, or a rule in the prompt about blocks that already list
things — but note B829: rewording the prompt has not fixed anything of this
shape before, and a code guard has fixed all of them. Prefer the guard.

Separately, either render the answer as markdown or stop emitting it — a
literal `**` on screen is a defect whatever else is decided.

## Acceptance

Ask for past conversations. The rows appear once.
