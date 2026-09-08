---
id: B932
title: The helper asserts what a day says without reading it
type: ISSUE
priority: high
complexity: low
area: agent, model
found: "2026-09-08T08:36:52Z"
started: "2026-09-08T08:37:28Z"
merged: "2026-09-08T09:00:11Z"
---

# B932 — The helper asserts what a day says without reading it

## Why

She said the saved text was missing "es war schön". The helper replied:

> "Der Text erwähnt bereits, dass es schön war."

with `proposals: []` — nothing to press. The actual draft on disk:

> "Wir waren am See spazieren. Danach gab es Kuchen."

No "schön" anywhere. Only after she repeated the complaint did it produce a real
correction, which worked.

This is the "already there" class of false claim: asserting what a day *says*
from memory rather than from the day. `read_day` exists and is a read tool the
model may call freely; it did not call it.

Same family as B920 (a write that did not happen) and B928 (a button that is not
there): the helper describing something the person can check and it cannot.

Found live on 2026-09-08.

## Work

When the model asserts what a day contains, it should have read it in that turn.
The cheapest honest version: if a turn's text makes a claim about the day's
content and no `read_day` was called, retry once telling it to look — the same
machinery B920 built.

The better version is a prompt rule that is also a habit: never say what a day
says without reading it first, and quote it back rather than summarising from
memory. Quoting is the thing that makes the claim falsifiable by the reader.

## Acceptance

The helper does not say what a day contains unless it read it in that turn.
