---
id: B808
title: The ask box answers a vague question confidently and wrongly
type: ISSUE
priority: high
complexity: low
area: agent
found: "2026-09-07T15:16:57Z"
---

# B808 — The ask box answers a vague question confidently and wrongly

## Why

`"wheres my stuff"` was routed to the **storage** intent with **0.72
confidence**, and answered "This journal holds 1 KB of its 5.0 GB."

The person meant: where are the things I put in. They were told about disk
space.

The router's own system prompt says exactly why this is the worst kind of
failure: *"A wrong guess costs them more than no guess."* At 0.72 it sailed
past the 0.5 floor B685 set, and B730 already notes that floor was a guess with
no traffic to tune it against. This is the first measured evidence about it.

Two other ordinary phrasings from the same tester came back `unknown`, which is
the honest answer and fine: `"put my photos up"` (0.1–0.3) and
`"hw do i shw my mum"` (0.2). Note what that pair means: the two most
predictable things a first-time person types both failed, while a phrase
nobody would naturally say — anything sounding like "storage" — worked.

## Work

Two separate things:

1. **The `storage` row's description is too greedy.** It should say it answers
   about disk space and room left, so a sentence about "stuff" does not land on
   it. This is a registry wording change, not a model change.
2. **"put my photos up" and "how do I show my mum" should both work.** The
   first is `write_day`; the second is the `who_can_read` row the plan
   proposes. Two rows that would have caught the two commonest sentences.

Feed the confidence number into B730's measurement rather than moving it here.

## Acceptance

"Where's my stuff" does not answer with disk space. "Put my photos up" opens
the wizard.
