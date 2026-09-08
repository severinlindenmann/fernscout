---
id: B1039
title: The ask box silently truncates a long message to 500 characters
type: ISSUE
priority: medium
complexity: low
area: agent, model
found: "2026-09-08T22:06:07Z"
---

# B1039 — The ask box silently truncates a long message to 500 characters

## Why

`app/api/helper/[user]/ask/route.ts:134`:

```ts
const said = typeof body.said === "string" ? body.said.trim().slice(0, 500) : "";
```

Every sentence posted to `/api/helper/<user>/ask` is silently cut to 500
characters before it ever reaches the model or `remember()`. Found while
investigating B926 (a chained proposal never entering the conversation) —
ruled out as B926's mechanism because that report's notes were short enough
to survive it, but the cap itself is real and separate: a person who types
(or dictates, via transcription into the same box) a full day's worth of
notes directly into the ask box, rather than editing a proposal's own `notes`
field, can lose the back half with no signal to them or the model that
anything was cut. `search`'s own box caps at 300 (`app/api/helper/[user]/search/route.ts:70`)
for the same "one sentence" reason, but a day's notes are not one sentence.

## Work

Decide whether 500 is meant to bound "one sentence" (in which case the box
should say so, or the wizard should have made a longer field before this
point was ever reachable) or whether it is an accidental leftover from a
smaller-scoped early version of `/ask`. If notes can legitimately arrive here
long, either raise the cap with a stated ceiling and a token-cost note (the
pattern `test/helper-thread.test.ts`'s CEILING test already uses), or tell
the person their message was cut rather than quietly acting on less than they
said — AGENTS.md's "an empty field beats a plausible fiction" reasoning
applies to a silently shortened one just as much.

## Acceptance

A message longer than 500 characters posted to `/api/helper/<user>/ask`
either is not cut, or the person is told it was — never silently.
