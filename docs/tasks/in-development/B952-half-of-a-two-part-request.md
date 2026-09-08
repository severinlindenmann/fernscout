---
id: B952
title: Half of a two-part request is answered and the other half is dropped without a word
type: ISSUE
priority: medium
complexity: medium
area: helper, model
found: "2026-09-08T11:09:17Z"
started: "2026-09-08T20:12:23Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:12:23Z"
---

# B952 — Half of a two-part request is answered and the other half is dropped without a word

## Why

Asked, in one breath:

> "…could you change the title of the 22nd to Homeward Bound … and also remind
> me what currency this journal counts money in…"

The title change was proposed. **The currency question was never answered and
never mentioned again.** Nothing said it had been dropped.

Not a false claim — nothing untrue was said — and that is what makes it its own
ticket rather than part of B944. It is the other way of misleading somebody: an
answer that looks complete because nothing in it admits to being partial. A
person who asked two things and got one answer has no way to tell whether the
second was refused, forgotten, or is coming.

The same shape appeared under an adversarial press earlier: *"publish today's
day and also delete the Tokyo trip"* correctly refused the deletion and
silently dropped the publish. Safe, and still only half answered.

There is a related, smaller instance worth fixing in the same pass: asked how
many credits were left, it said *"you have credits remaining"* without the
number, which `GET .../status` was holding (`balance: 9`). Vague where it could
be exact. **Left for a separate ticket** — see below.

**Confirmed still live** (2026-09-08, this session): `lib/helper/model.ts`'s
`amiss()` — the honesty net's whole list of checks — had nothing that looked at
what the *person's* message asked versus what the turn actually did. Every
existing check (`claimsAccess`, `claimsWhatADaySays`, `claimsATotal`, …)
catches a false claim in the model's own words; an omission makes no claim, so
none of them fire. The fault was real and unfixed on `main` at the start of
this ticket.

## Work

Probably the prompt, and B829 says that is a weak lever — so consider what is
checkable instead. One candidate: the turn already knows which tools it called;
a sentence-count or question-count heuristic is not it, but *a question mark in
the person's words with no read tool called* is a signal worth looking at.

Not doing: forcing every turn to enumerate what it did.

**Built**: `droppedAQuestion(said, looked)` in `lib/helper/model.ts` — true when
the person's message carries a `?`, the turn called a **write** tool (so it did
act on the other half of the message), and it called **no read tool at all**
(so the question could only have been answered from memory or invented). Wired
into `amiss()` as a new `"dropped"` outcome, with its own retry
(`DROPPED_RETRY`, telling the model to look again and answer with a tool or say
plainly it has not gotten to it) and its own plain fallback
(`agent.stillHasAQuestion`, in all three locales) for when the retry still says
nothing about it.

Deliberately narrow, matching the ladder in the ticket:
- A turn that calls no tool at all is left alone — nothing was dropped, the
  whole answer came from the conversation itself (an ordinary follow-up like
  "and what does draft mean?").
- A turn that reads *something* (`account`, `trip_costs`, `read_day`, …) is
  left alone, whether or not that read happens to be what answers the
  question — a false negative here is only ever a missed catch, never a false
  claim, and the shape it is built to catch (title changed, currency ignored)
  always has a write with no read anywhere in the turn.
- The written-note/`publish + delete` example in the ticket (a refusal, not a
  question) is **not** caught by this check — there is no `?` in "publish
  today's day and also delete the Tokyo trip". That shape is a different
  signal (a second imperative rather than a second question) and is out of
  scope for this ticket; noted below as a capture.

**Not doing**, per the ticket: the "vague credits" instance
(*"you have credits remaining"* without the number `account` actually
returned) — this is a different fault (an answer waters down a fact it *did*
read, rather than dropping a second ask entirely) and belongs in its own
ticket rather than being folded in here. Captured as B1029.

**Also not doing**: a check for a dropped *second imperative* (the
`publish + delete` shape, no question mark at all) — captured as B1030, since
it needs a different signal (this ticket's `?`-based check does not fire on
it) and folding it in here would have widened the diff past what one ticket
should carry.

## Acceptance

A compound sentence with a write and a question gets both, or is told which
part was left. Add it to the honesty suite.

**Evidence** — `test/helper-honesty.test.ts`, new `describe` blocks:

- `droppedAQuestion` (unit-level): true for a write tool + a `?` + no read
  tool; false for a plain statement with no question; false when a read tool
  ran alongside the write; false when nothing was written at all.
- `"a compound message where the write is answered and the question is not"`:
  - a title-change tool call (`set_day_words`) followed by an answer that only
    addresses the title is caught, retried, and — when the retry calls
    `account` and answers both halves — the full two-part answer reaches the
    person, with the proposal still on screen (4 model calls total).
  - when the retry *still* says nothing about the question, the plain fallback
    (`agent.stillHasAQuestion`) is what reaches the person instead, and the
    proposal from the first half is not undone by the omission being caught
    (3 model calls total).
  - a plain, single-part request (no `?`) is left alone (2 model calls, no
    retry).

All new tests fail against the code as it stood at the start of this ticket
(no `droppedAQuestion`, no `"dropped"` branch in `amiss()`) and pass after.

## Verify

`npm run verify` — see session notes; two known-noise categories excluded per
the dispatch instructions (`test/task-ids.test.ts` stale snapshot, and any
30-second timeout re-run alone). Full result recorded in the merge/report.
