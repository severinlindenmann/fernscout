---
id: B926
title: The helper forgets what it was told one message ago
type: ISSUE
priority: high
complexity: low
area: agent, model
found: "2026-09-08T07:12:21Z"
started: "2026-09-08T21:49:14Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:49:14Z"
---

# B926 — The helper forgets what it was told one message ago

## Why

> "After a failed write attempt, the very next turn asking 'please write up the
> Kazbegi day' got: *'I need your notes about that day to turn into words. What
> do you want to say about it?'* — it had already seen the full notes twice in
> the conversation and forgot them entirely one message later."

The thread keeps twelve turns (`lib/helper/thread.ts`), so the notes were in the
conversation. Two candidates, and they need telling apart before anything is
changed:

- The turns are stored but not reaching the model in a usable form — for
  instance only the person's text is kept and the model's own prior answers are
  not, so it cannot see what it was working on.
- Or the failed write reset something it should not have.

Found live on 2026-09-08.

## Work

Reproduce first: three turns, notes in turn one, a failure in turn two, a
request in turn three. Look at exactly what the model is sent on turn three.

The fix is probably in what the thread keeps rather than in the prompt. Note
that B889 deliberately keeps **only plain text** and drops `tool_use` /
`tool_result` blocks so trimming cannot orphan a result — that was right for
avoiding a 400, and it may be why the model cannot see what it did.

## Acceptance

Notes given three turns ago are still usable when the write is retried.
