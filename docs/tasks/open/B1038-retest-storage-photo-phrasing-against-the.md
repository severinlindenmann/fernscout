---
id: B1038
title: Retest storage/photo phrasing against the live helper under the new tool-calling router
type: ISSUE
priority: low
complexity: low
area: agent
found: "2026-09-08T21:44:20Z"
---

# B1038 — Retest storage/photo phrasing against the live helper under the new tool-calling router

## Why

B829 found "wheres my stuff" answering with megabytes and "put my photos up"
falling through to `unknown`, against the old pre-model router in
`lib/helper/intents.ts`. B900 (`51aaea86`) deleted that router entirely: a
sentence that survives the deterministic refusal table now goes to
`answerInThread` in `lib/helper/model.ts` with the whole tool registry
(`lib/helper/tools.ts`) as real function-calling schemas, in conversation.
B829 was closed as superseded on that evidence — the two tool descriptions it
asked for (`account`'s "Bytes only — never where anything is",
`start_day`'s "ready for words and photographs") were already in the file
`51aaea86` introduced, `lib/helper/tools.ts:548` and `:759`.

What nobody has done is run the two actual sentences through the new
mechanism. Real function-calling with full conversational context behaves
differently from a row matched on phrasing alone, and could easily behave
better — but "could" is not "does", and this repository's own rule is that a
description change is not a fix until it is measured (that is the finding
B829 exists to record).

## Work

Against the **live model** (not a stub — B829's own lesson), in a fresh
`/agent` conversation as an owner with a journal that has at least one trip
and some disk usage:

- Send "wheres my stuff" (and, since the tools are English-described but the
  helper is offered in German and Hungarian too, an equivalent in each) and
  record which tool the model calls, if any, and what it says.
- Send "put my photos up" and record whether it reaches `start_day` (or asks
  a clarifying question), or falls through to nothing/`unknown`-shaped prose.
- If either still misbehaves, decide in code, not in a longer `describe`
  string — B829's own finding is that wording is not a lever here.

## Acceptance

A transcript (or equivalent evidence) of both sentences run against the live
model, showing the tool called (or the clarifying question asked) for each —
closing this either confirms B900's rewrite already fixed B829's two cases in
practice, or turns up a fresh, code-guardable bug against the current
architecture.
