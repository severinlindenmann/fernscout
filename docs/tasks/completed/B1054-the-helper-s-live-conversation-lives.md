---
id: B1054
title: The helper's live conversation lives in one process's memory, so no second door can ever join it
type: FEATURE
priority: high
complexity: high
area: helper, thread, db, channels
found: "2026-09-09T07:11:40Z"
started: "2026-09-09T20:27:39Z"
merged: "2026-09-09T22:06:50Z"
completed: "2026-09-10T15:12:23Z"
---

# B1054 — The helper's live conversation lives in one process's memory, so no second door can ever join it

## Why

`lib/helper/thread.ts:82` is the whole of it:

```ts
const threads = new Map<string, {id, turns: Turn[], touched: number}>()
```

A process-local `Map`, keyed by username, thirty minutes' TTL, twelve turns
kept, swept above a thousand entries, and gone on every deploy. It is the
right amount of machinery for one browser talking to one server, and it is the
single thing that stops a second door existing.

Everything a second door would need is already durable and already correct.
`lib/helper/sessions.ts` writes every turn and every press into
`helper_sessions`, and `turnsIn()` reads them back so a person can reopen a
past conversation at `/agent?c=<id>`. What is *not* durable is the thread the
model is actually handed — so a conversation reopened from history is a
transcript to read, not a conversation to continue.

That is the bug even without a second channel. B976 shipped the history; a
person who reopens yesterday's conversation and types into it is talking to a
model that has been told nothing about it.

With a second channel it becomes structural. The requirement is that somebody
writes on WhatsApp, opens `/agent`, and finds the same conversation — so the
live thread has to be a row, not a `Map` entry, and the session id has to be
the thing both doors look up rather than the username.

Two properties the current shape gets right and a rewrite must keep:

- **One conversation per journal, not per device.** The key is the username
  today, which is why opening a second browser tab continues the same
  conversation rather than starting a rival one. That is the behaviour a
  person expects from a messenger too.
- **Notes are model-only.** `proposed()`, `wrote()` and `refused()` push
  `[proposed: …]` turns that the person never sees, and `model.ts` folds them
  onto the *next* user message rather than sending them as turns of their own
  (B924, so the model stops imitating its own brackets). Whatever stores the
  thread has to keep the distinction.

## Work

- Give the live thread a home in the database, beside `helper_sessions` rather
  than inside it: that table is an append-only record of what happened, and
  the thread is mutable state with a TTL. Two tables, or one table and a
  `kind`, is a decision for whoever takes this.
- Key it by session id. `sessionId(username)` becomes "the live session for
  this journal, or a new one", and both doors resolve to the same row.
- Keep the twelve-turn window and the `[earlier turns…]` collapse. They are a
  token budget, not an artefact of being in memory.
- Reopening a past conversation makes it live again, rather than showing it.
  That is the acceptance test worth writing first.
- Decide what a deploy does. Today a deploy silently ends every conversation;
  once the thread is durable it does not, which is better and is also a change
  in behaviour somebody should have chosen.

Not doing: the second channel itself (B1057), the rendering seam (B1056), or
changing what the model is told.

## Acceptance

A conversation reopened from `/agent?c=<id>` after a server restart continues:
the next answer refers to something said before the restart, and
`test/helper-thread.test.ts` proves it without a live model.

## Decided — 2026-09-09

Answered by the owner:

- **Every turn is marked with its origin**, not only the WhatsApp ones. That
  is a column on the turn record and belongs here rather than in B1056, since
  it is stored state and not a rendering decision. Browser turns carry a
  browser origin, WhatsApp turns carry WhatsApp, and a third channel needs no
  schema change.

## Decided further — 2026-09-09

A second pass of questions, and one answer changes this ticket's shape.

- **The thread lives 24 hours on WhatsApp**, not thirty minutes. Today's
  `TTL_MS` is right for a web room — somebody sits down and works — and wrong
  for a messenger, where people write once at the end of a day. With thirty
  minutes, every WhatsApp message is a cold start and the model re-asks which
  trip and which day each time.
  - The TTL therefore becomes **per channel**, not a constant. The web room
    keeps its thirty minutes unless somebody decides otherwise separately.
  - The 12-turn window stays. It is a token budget, and a longer-lived thread
    needs it more, not less.
- **One thread, genuinely**, reachable from both doors — including the
  awkward case where a WhatsApp message arrives while a browser tab is open
  and the two interleave. Accepted deliberately: it is rare for one person,
  and the origin marks make it legible after the fact. No web-room-is-open
  heartbeat, no channel locking.
