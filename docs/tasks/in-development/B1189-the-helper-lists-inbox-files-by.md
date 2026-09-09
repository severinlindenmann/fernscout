---
id: B1189
title: The helper lists inbox files by name and in the same breath says it cannot find them
type: ISSUE
priority: high
complexity: medium
area: helper
found: "2026-09-09T21:26:16Z"
started: "2026-09-09T21:26:47Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T21:26:47Z"
---

# B1189 — The helper lists inbox files by name and in the same breath says it cannot find them

## Why

Persona round (Jonas, live site, 2026-09-09): "put these photos on today's
day" → clarification; "the two waiting in my inbox" → the model listed both
files by name ("jonas-1.jpg — photograph, 1 KB") and in the same message
said "I cannot find those photographs waiting in the inbox, so nothing has
moved." A claim and its contradiction in one breath — the exact shape
AGENTS.md's net exists for. Screenshot: jonas-07-inbox-contradiction-bug.png.
Manually ticking the tiles and saying "the 2 selected" worked.

## Work

Trace the attach path when the person refers to inbox files in words with
nothing selected: which tool ran, what ids it was given, why the read that
listed the files and the attach that denied them disagreed. Likely the
attach tool wants explicit inbox ids and the model invented or mangled
them; the fix may be a tool that can say "the files waiting in the inbox"
as a set, or a guard that a turn listing files must not claim they are
unfindable.

## Acceptance

On the live site, uploading two photos and saying "put the waiting photos
on today's day" either attaches them or asks a question — never lists them
and denies them in one message.
