---
id: B1038
title: Retest storage/photo phrasing against the live helper under the new tool-calling router
type: ISSUE
priority: low
complexity: low
area: agent
found: "2026-09-08T21:44:20Z"
started: "2026-09-11T08:42:25Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T08:42:25Z"
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

## Transcript (2026-09-11)

Run against the live instance, `https://fernscout.ch/agent`, as the owner of
the `example` journal (an owner cookie via `get-a-credential`'s
`get-token.sh live example cookie`) — real journal state: seven photographs
and one CSV waiting in the inbox, two draft days with no photographs yet,
426 MB of 15 GB used, real function-calling against the live model. Each
sentence below was sent in its own fresh conversation (`New conversation`).

| Sentence | Language | Tool called | Result |
| --- | --- | --- | --- |
| "wheres my stuff" | en | inbox list | Named all 8 waiting files by name and kind ("image.jpg — photograph, 2 MB", …), then named the 2 unfinished draft days. **B829's English case is fixed.** |
| "put my photos up" | en | inbox list | Listed inbox contents, then: "You have seven photos in the inbox. You have two unfinished days waiting for photos — press one to put them there." A clarifying question, not a fall-through to `unknown`. **B829's English case is fixed.** |
| "Hol vannak már a cuccaim?" (idiomatic hu for "wheres my stuff") | hu | inbox list | Listed all 8 files in Hungarian, asked "Melyik napra szeretnéd ezeket felrakni?" (which day). Correct. |
| "Töltsd fel a képeimet" (idiomatic hu for "upload my photos") | hu | trip list | Listed the journal's trips, named the one still running, asked which day's photos to upload or whether a different trip was meant. A reasonable clarifying path, not a fall-through. |
| "Wo ist eigentlich mein ganzer Kram?" (idiomatic de for "wheres my stuff") | de | **`account`** | Answered in bytes only, the exact B829 failure mode: *"Du nutzt etwa 426 MB von deinen 15 GB. Das ist vor allem deine Fotos und die fertig gestalteten Fotobücher und Postkartenseiten. …"* Never mentioned the seven waiting photographs or two draft days. |
| "Lad hoch meine Fotos" (idiomatic de for "put my photos up") | de | inbox list | Listed inbox contents, asked which day the photos should go on or whether to start a new day. Correct. |

**Conclusion: B900's rewrite fixed both of B829's original English cases in
practice**, confirmed against the live model rather than assumed from the
tool descriptions alone. The Hungarian equivalents of both sentences also
behaved correctly. One German phrasing of "wheres my stuff" reproduced
B829's exact failure — bytes-only, no mention of what was actually
waiting — on a single run; captured as B1432 rather than fixed here, per
this ticket's own instruction that a misbehaving sentence is a fresh
ticket and this one stays a measurement.
