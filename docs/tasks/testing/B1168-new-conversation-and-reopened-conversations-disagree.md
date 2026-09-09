---
id: B1168
title: New conversation and reopened conversations disagree with the thread that answers
type: ISSUE
priority: high
complexity: medium
area: helper room
found: "2026-09-09T20:04:46Z"
started: "2026-09-09T20:06:20Z"
merged: "2026-09-09T20:26:52Z"
---

# B1168 — New conversation and reopened conversations disagree with the thread that answers

## Why

Three session behaviours contradict what is on the screen, reproduced in a
real browser on 2026-09-09:

- **"New conversation" does nothing visible.** `newConversation()` in
  `components/HelperRoom.tsx:371` DELETEs the thread and reloads bare
  `/agent` — and `app/agent/page.tsx:118` resolves a bare visit to the most
  recent *stored* session (`sessionsOf`), so the conversation just "ended"
  redraws in full. Before/after screenshots are identical.
- **Typing into a reopened conversation extends an invisible other thread.**
  `?c=` draws stored turns, but the next `ask` continues the in-memory
  thread keyed only by journal (`lib/helper/thread.ts:128`) and is recorded
  under *its* session id — so the continuation lands in the history panel as
  its own one-turn "conversation", the fragmentation B1109 was about, back
  through another door.
- A bare `/agent` visit resumes a conversation that may have died hours ago
  (the thread TTL is 4h) as though it were live, while the next sentence
  silently starts a new session.

## Work

- `lib/helper/thread.ts`: an `adopt(username, session, turns)` that makes the
  in-memory thread carry a stored session's id and its last `MAX_TURNS`
  turns, so continuing a reopened conversation is real.
- `app/agent/page.tsx`: `?c=<id>` adopts; `?c=new` (what the + button
  navigates to) skips the resume outright; a bare visit resumes only when
  the stored latest session is the live thread's own or within the TTL — and
  adopts it, so typing continues it.
- `components/HelperRoom.tsx`: `newConversation()` navigates to
  `/agent?c=new`; the history panel marks the live conversation.
- Not doing: server-side persistence of the thread itself (the 4h in-memory
  model stays), streaming, or any change to what is recorded per turn.

## Acceptance

- Press + on a room showing turns: the conversation area is empty (opening
  cards only), and the old conversation is still in the history panel.
- Open a conversation from the history panel, type a sentence: the new turn
  is recorded under that same `session_id` in `helper_sessions` (assert via
  a vitest on adopt + record path), and the history panel does not grow a
  new one-turn conversation.
- `npx vitest run test/helper-thread.test.ts` (new cases) passes.
