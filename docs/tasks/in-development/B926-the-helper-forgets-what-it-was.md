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

### What was found

Neither of the two candidates above was it, and neither was B971's or B952's
mechanism (both checked and ruled out by their own agents first). The real
gap: **`app/api/helper/[user]/proposal/route.ts` — the route a chained
proposal posts to when one write tool's `next` opens a second card with no
model call in between (`start_day` chaining straight to `draft_words`, B969)
— never told the thread anything.** Every proposal the *model* makes inside
`/ask` gets a `[proposed, not written, waiting to be pressed: …]` note
(`app/api/helper/[user]/ask/route.ts`), which is how a correction like "no,
the 14th" works on the next turn. A *chained* proposal — built deterministically
by `proposalFor()` from the previous press's own answer, never touching the
model — got no such note. It still carries the person's notes in
`arguments.notes` (verified: `start_day`'s `next.from` only names `trip` and
`slug`, but `arguments` starts from every string the model supplied, so
`notes` rides along unlisted), and it is still what the person sees and
presses — but the *conversation* had never heard of it.

So: person describes a day → `start_day` is proposed with `notes`, and that
first proposal note IS recorded. Person presses it, it succeeds, and a
`[written: start_day …]` note lands *after* it — carrying only `trip`,
`slug`, `date`, never the notes. `start_day`'s success chains straight to a
`draft_words` proposal (real notes, real title-drafting) via
`POST /api/helper/[user]/proposal`, entirely invisible to the thread. If
*that* press then fails (no credits, a transient model error, anything —
`refused()` deliberately never touches the thread, and rightly so per its own
doc comment), the only record left is the stale, now-contradicted
`start_day` note ("not written" for a tool a later note says WAS written) —
about the wrong tool, with no mention of `draft_words` at all. Asked to try
again, the model has nothing usable to reuse and asks for the notes over.

This is exactly B971's mechanism, one hop further down the chain: B971 fixed
`write-day`'s own success path (real words now enter the conversation via a
`note()` call there); nothing had fixed the *chain* step that never went near
`write-day`, `/ask`, or a model call at all.

### What changed

- `lib/helper/thread.ts`: added `proposed(username, tool, args)`, factoring
  out the `[proposed, not written, waiting to be pressed: …]` marker that used
  to be written inline only in `app/api/helper/[user]/ask/route.ts`.
- `app/api/helper/[user]/ask/route.ts`: uses `proposed()` instead of building
  the marker by hand (no behaviour change here — this call site already
  worked).
- `app/api/helper/[user]/proposal/route.ts`: now calls `proposed()` too, for
  the proposal it builds with no model in the loop. This is the actual fix —
  a chained proposal now enters the conversation the same way a model-made one
  always did, so its own `arguments` (including any notes) are still there for
  a later turn even if the press that followed it failed.

A data fix, not a prompt reword, per AGENTS.md and B971's precedent: the model
was never told anything false and never needed telling anything new in words —
it was simply never shown the fact.

### Evidence

`test/helper-thread.test.ts`, new describe block "a proposal chained without
the model — B926":

- `enters the conversation, same as one the model proposed itself`: presses
  `/api/helper/alex/proposal` directly for `draft_words` with `notes:` a full
  paragraph, and asserts `history("alex")` now has a note containing the tool
  name and the verbatim notes. **Fails before the fix** (`history()` was
  empty — verified by reverting the three source files and re-running).
- `survives a failed press, and the next turn can still use it`: same
  proposal, then a press to `write-day` forced to fail on `no_credits`
  (draining the balance rather than mocking the model, so the failure is
  real), then a fresh `/ask` turn asking to "write up the Kazbegi day" — and
  asserts the *messages actually sent to the model* on that turn contain both
  `draft_words` and the original notes text. **Fails before the fix** for the
  same reason.

Both pass after the fix; `npm run verify` is clean (453 files, 5815 tests,
build/tsc/eslint/vitest/knip all green).

### Context size

No growth. The fix adds one already-existing marker line (same format, same
call) at a second call site — it does not add anything new to what the model
is sent, it only stops a *fact that already existed* (a chained proposal's own
notes) from going unrecorded. The 4,100-token prompt+tool-list ceiling test in
`test/helper-thread.test.ts` ("the prompt and the tool list stay under
forty-one hundred tokens") is unaffected since nothing here touches the
prompt or the tool schemas.

### Not done here — a related but distinct gap, for `backlog/`

`app/api/helper/[user]/ask/route.ts:134` truncates every message to the
model to 500 characters (`.slice(0, 500)`). A person typing a full day's
notes directly into the ask box rather than through a proposal's own `notes`
field could exceed that and be silently cut, which is a different mechanism
from the one this ticket was about (this is about the *first* message being
cut, not a later turn losing something that was there). Filed separately;
see the capture below.

## Acceptance

Notes given three turns ago are still usable when the write is retried.

**Verified**: see "Evidence" above. The failing-before/passing-after test
pair in `test/helper-thread.test.ts` drives the exact chain the live report
described — notes given, a chained proposal carrying them, a failed press,
and a fresh turn — and confirms the notes reach the model on that fresh turn.
