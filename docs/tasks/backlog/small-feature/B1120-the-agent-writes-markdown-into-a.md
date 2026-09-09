---
id: B1120
title: The agent writes markdown into a plain-text answer, so people read literal asterisks
type: FEATURE
priority: high
complexity: medium
area: lib/helper/answer.ts, lib/helper/model.ts
found: "2026-09-09T17:45:57Z"
---

# B1120 — The agent writes markdown into a plain-text answer, so people read literal asterisks

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`lib/helper/model.ts` lets the model answer in free text, and the model
writes markdown. On the live site a person reads:

> Der Tag „The night train north" vom 24. Januar steht so auf deiner Seite:
> \*\*The night train north\*\* Thirteen hours, a bunk with a curtain, and a man
> with a trolley who appeared every ninety minutes …

Literal asterisks, and a whole day's prose flattened into one grey paragraph
with the agent's own question at the end of it. Nothing marks where the
journal's words stop and the agent's begin, which is the one boundary this
product cares most about.

B1108 is the same fault at a different angle: a read tool's block already *is*
the answer, and the model says it again underneath in prose.

## Work

Two halves.

**A small declared vocabulary**, rendered — and nothing outside it. Four marks,
each mapping to something the journal already means:

| mark | means |
| --- | --- |
| `**bold**` | a name of a thing in the journal — a title, a date, a trip |
| `- item` | two or more things of the same kind; never one |
| `> quote` | words that came out of the journal, and only that |
| meta line | counts and states about the thing just named, small and grey |

Anything else renders as plain text, so an unsupported mark degrades to a
readable sentence rather than to punctuation.

**A block for a quoted day**, so quoting stops being prose. The registry
already has `preview`; the model should reach for it rather than inlining a
day's words.

Not doing: a markdown library, tables, headings, images, or links.

**The thing to be careful about.** The honesty net in `lib/helper/model.ts`
reads the answer *text*, and every guard matches on it. Rendering must happen
strictly after the net and must never rewrite the string the net inspected — a
renderer that normalised sentences before the guards saw them would quietly
disarm the whole of it. Parse for drawing; keep the source.

## Acceptance

Ask the room to show a day. No asterisk appears on screen, the day's own words
sit in their own marked block, and `test/helper-answer-format.test.ts` asserts
an unsupported mark renders as its own literal text rather than vanishing.
