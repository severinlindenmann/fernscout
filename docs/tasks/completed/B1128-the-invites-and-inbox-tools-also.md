---
id: B1128
title: The invites and inbox tools also say their own block back in prose
type: ISSUE
priority: low
complexity: low
area: lib/helper/tools/areas/readers.ts, files.ts
found: "2026-09-09T17:59:14Z"
merged: "2026-09-09T19:41:25Z"
---

# B1128 — The invites and inbox tools also say their own block back in prose

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B1120 fixed `past_conversations`: its block already lists the rows, and the
model was saying the whole list again underneath in prose. The fix was one
sentence in the tool's `describe`.

Two more tools have the same shape and were deliberately left alone, because
their files belonged to other agents at the time:

- `invites` in `lib/helper/tools/areas/readers.ts` — a `choose` block listing
  every link, and a `describe` that says nothing about not repeating it.
- `inbox` in `lib/helper/tools/areas/files.ts` — a `files` block listing what
  is staged, same silence.

The general rule is worth stating once rather than three times: **a read tool
whose block already is the answer should say a sentence at most.** Nothing in
the registry says so, so each new read tool will arrive with the same fault.

## Work

Add the sentence to both `describe`s, the way B1120 did for
`past_conversations`. Then consider whether it belongs in the prompt instead of
in three tool descriptions — but read the ceiling comment in
`test/helper-thread.test.ts` first: there were 271 tokens of headroom after
B1120, and a rule in the prompt costs every turn while a rule in a `describe`
costs only when that tool is offered.

My guess, worth checking rather than trusting: the `describe` is the right
place precisely because it is paid for only when relevant. Which would make
this three copies of one sentence on purpose, and worth a comment saying so.

## Acceptance

Ask what invite links exist, and what is in the inbox. Each answers with the
block and at most one sentence, not the list twice.
