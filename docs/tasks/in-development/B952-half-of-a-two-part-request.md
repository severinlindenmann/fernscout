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

**Built, then found unsafe, then narrowed — round 2 (2026-09-08, same session,
on the coordinator's review before merge).**

First version: `droppedAQuestion(said, looked)` fired when the person's
message carried a bare `?`, the turn called a **write** tool, and it called
**no read tool at all**. Before asking to merge, the coordinator named the
exact failure mode AGENTS.md calls out: *"could you write up today? we went to
the museum and then the harbour"* is a `?`, produces one write (`draft_words`)
and reads nothing — and is an **honest, single-part request**, not a dropped
question.

**Verified empirically rather than argued.** Added five scripted scenarios to
`test/helper-honesty.test.ts` for exactly that shape — the English phrasing
above, a German equivalent (*"Kannst du den heutigen Tag schreiben? Wir waren
im Museum und dann am Hafen."*), a Hungarian one (*"Megírnád a mai napot?
Elmentünk a múzeumba, aztán a kikötőbe."*), and two bare confirmations with no
notes at all (*"shall I put this in for the 14th?"*, *"can you save that?"*) —
and ran them against the bare-`?` version. **All five misfired**: 3 model
calls instead of 2 on every one of them, meaning the guard retried an honest
turn and, had the retry not happened to add a number, would have told the
person in their own language that they still had a question outstanding, on
what is arguably the single most common sentence shape in the whole product.
This is exactly the failure the ticket's own Work section already flagged as a
risk ("a sentence-count or question-count heuristic is not it") and the first
build did not go far enough past it.

**The fix**: replaced the bare `?` with `FACT_QUESTION_WORD`, a small closed
set of fact-seeking words per language (`what`/`when`/`where`/`who`/`which`/
`how many`/`how much`/`remind me`; `was`/`wann`/`wo`/`wer`/`welche…`/`wieso`/
`weshalb`/`wie viel(e)`/`erinnere`; `mit`/`hány…`/`mikor`/`milyen`/`mennyi…`/
`melyik`/`mondd meg`). A polite request to *do* something ("could you...",
"kannst du...", "megírnád...", "shall I...", "can you...") carries no such
word; a request for a *fact* ("what currency...", "remind me...", "wie viel
kostet...") does. This is not the open-ended claim-phrasing AGENTS.md warns
against (an infinite space of ways to say "it's done") — it is a small, closed
grammatical class, the same kind of per-language list this file already keeps
for other checks (`A_TOTAL`, `CLAIM`, `DENIED`), combined as always with a
condition on what the turn actually did (a write ran, no read did).

**Re-verified**: all five of the coordinator's honest siblings now leave the
turn alone (2 model calls, no retry); the original currency example, and the
in-repo test's German equivalent, still catch (the retry fires, and either
recovers with both halves answered or falls back to the plain sentence).

**Known remaining limit, stated plainly rather than hidden**: a fact question
phrased without any of these words (imaginable, if rare, in any of the three
languages) will not be caught — a missed catch rather than a false one, which
is the side AGENTS.md says to prefer when a guard cannot be made to hold both
ways at once. This was judged an acceptable trade against the alternative of
dropping the guard entirely, given it now holds against every concrete case
either the ticket or the review named; a differently-phrased fact question
slipping through is the same shape of gap every check in this file already
lives with (e.g. `claimsAWrite`'s own English/German/Hungarian phrase lists).

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

`npm run verify` (build → tsc → eslint → vitest → knip), run twice in this
session, in the foreground both times — once before the round-2 narrowing and
once after: **all 5 stages passed both times**, 5771 tests passing after the
five new honest-sibling tests were added (up from 5766). No known-noise
failures (`test/task-ids.test.ts`, 30-second timeouts) were encountered either
time.
