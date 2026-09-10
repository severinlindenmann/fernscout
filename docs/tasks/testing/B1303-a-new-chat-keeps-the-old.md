---
id: B1303
title: A new chat keeps the old pending button, and the thread has no sense of time
type: ISSUE
priority: high
complexity: low
area: whatsapp, helper, honesty
found: "2026-09-10T11:51:13Z"
merged: "2026-09-10T12:27:09Z"
---

# B1303 — A new chat keeps the old pending button, and the thread has no sense of time

## Why

scenario-multimsg.md defect 2: "neues gespräch" (`lib/whatsapp/dispatch.ts`'s
`isNewChatCommand` handler) calls `forget(username)`, which clears
`helper_threads`, but never touches
`lib/whatsapp/pendingProposal.ts`'s on-disk store — keyed only by
`(username, tel)`, with no session id in it. A proposal held before the
reset was still live after it: pressing its button in the "fresh" thread
silently wrote a day nobody had mentioned in the new conversation, and the
just-reset `helper_threads` row immediately gained a `[written: ...]` note
about it — exactly the thing "neues gespräch" exists to prevent (a
conversation the person cannot end is one they stop trusting,
`lib/helper/thread.ts:522-525`).

scenario-edges.md finding 6, separately: the system prompt has always
promised "long gap, new subject: ask — continue, or fresh"
(`lib/helper/model.ts:499`) with nothing behind it. `Turn` carries no
timestamp, so that line can only ever fire on the model's own guess at a
topic change — and in a live run it did not fire even on a real one
(day-publishing talk → postcards, after a 7-hour gap). The WhatsApp thread's
own TTL is 24h (`lib/helper/thread.ts`'s `TTL_MS.whatsapp`), so the gap
question is supposed to fire well before that hard expiry, and nothing gave
it the elapsed time to fire on.

## Work

- `lib/whatsapp/pendingProposal.ts` gained `clearPendingProposal(username,
  tel)`, and the `isNewChatCommand` handler in `lib/whatsapp/dispatch.ts`
  calls it alongside `forget()`. A stale button now finds nothing waiting on
  the other side of a reset, the same honest `wa.proposalGone` a genuinely
  stale tap already gets.
- `lib/helper/thread.ts` gained `lastTouched(username)`, reading the same
  `ThreadState.touched` the TTL check already uses. `lib/whatsapp/
  dispatch.ts`'s `answerOnWhatsapp` computes the gap since last touch before
  calling the model and, when it is 4+ hours (`GAP_NOTE_HOURS`), folds one
  line — `[gap: about N hours since the last message]` — onto the turn's own
  history the same way any other note folds in (riding on this turn only,
  never persisted). This is what lets the existing "long gap, new subject:
  ask" prompt line actually have something to fire on; no prompt wording was
  touched.

## Investigation: scenario-edges.md finding 7 ("worüber haben wir gerade
geredet?" after "neues gespräch")

Checked against this ticket's own fix and found **not** explained by the
pending-proposal leak — that leak is a write executing across the reset; this
finding is purely conversational. Mechanically, `forget()` genuinely starts a
clean thread (confirmed via SQLite in the original run: the old turns are not
in the new thread's own `turns` column). The model then calls
`past_conversations` (`lib/helper/tools/areas/journal.ts:227-254`), reads the
just-closed session back, and answers *"Du hattest vor Kurzem ein
Gespräch... Sollen wir das fortsetzen?"* — conflating "recently, in a closed
session" with "just now, in this one". The tool's own `describe` already says
"say one short sentence at most, never the list again in prose"; the model's
answer both restated the entry and invited resuming it, which softly
violates that too.

Not fixed here: it is not a false claim about a write, a price or a
capability (the three shapes B1306's two-line prompt budget is spent on), and
the honest fix is more prompt wording this project is deliberately short on
(AGENTS.md: "the prompt is also the scarcer resource"). Recorded rather than
guarded — a candidate for a future ticket if it recurs, most likely as a
narrower system-prompt note beside `past_conversations`' own tool description
rather than the shared system prompt.

## Acceptance

- `test/whatsapp-new-chat.test.ts` ("a proposal held before the reset cannot
  still be pressed after it"): a proposal held before "new chat", pressed
  after it, gets the honest `wa.proposalGone` sentence rather than a write.
- `test/whatsapp-model-turn.test.ts` ("a gap since the last message"): a 7h
  gap folds `[gap: about 7 hours since the last message]` into the next
  model call; an ordinary back-to-back exchange adds no such note.
