---
id: B1302
title: A typed button label is not a press, and a false saved-claim slips a session-wide guard
type: ISSUE
priority: high
complexity: low
area: whatsapp, helper, honesty
found: "2026-09-10T11:51:12Z"
merged: "2026-09-10T12:27:08Z"
completed: "2026-09-10T15:12:41Z"
---

# B1302 — A typed button label is not a press, and a false saved-claim slips a session-wide guard

## Why

scenario-margrit.md's headline finding, live on a real number. Margrit typed
the exact label of a `confirm` proposal's own accept button ("Diesen Text
speichern") instead of tapping it. `lib/whatsapp/dispatch.ts` has no
mechanism that reads a typed reply against the pending proposal at all —
every typed message, including an exact button label, goes to the model as
ordinary text (`lib/whatsapp/dispatch.ts:667-670`'s own doc says so). The
model, with nothing to call, answered as though `set_day_words` had already
been pressed. It had not; the day on disk never changed.

That false claim should have been caught by `lib/helper/model.ts`'s honesty
net, and was not, because of a second, independent bug: the net's "nothing
was written, so a 'saved' claim is false" check (`lib/helper/model.ts:1930`
before this fix) read `written.size === 0` — "has anything, ever, been
written this whole session" — rather than "was anything written by *this*
turn". `start_day` had genuinely been pressed two turns earlier in the same
conversation, so `written` was non-empty, and the guard let a claim about a
completely different, unwritten change (the day's title and prose) sail
through.

Two more findings from the same run, smaller but real: a typed "jaa gerne"
("yes, gladly") — natural language, not the exact `wa.yes` phrase — got
total silence at the consent gate rather than any acknowledgement that the
message had even arrived; and an invented "this costs a credit" claim for
`start_day`, which is free (covered by B1306).

## Work

- `lib/whatsapp/dispatch.ts`: before a text message reaches the model, compare
  it (case-folded, trimmed) against the pending proposal's accept label (the
  button's own truncated title), its full untruncated `accept` sentence, and
  the decline word (`wa.declineButton`). A match is routed to
  `handleProposalReply` exactly as a real button tap is; anything else falls
  through unchanged. `lib/whatsapp/pendingProposal.ts` gained
  `peekPendingProposal` (read without consuming) so a non-matching message
  never loses the proposal it did not press; `lib/whatsapp/render.ts` now
  exports `truncate`/`BUTTON_TITLE_MAX` so dispatch can compute the same
  truncated title the button actually showed.
- `lib/helper/model.ts`: `written` (session-wide) stays for the specific-tool
  check at line ~1893 (B944's own reasoning still holds there); a new
  `writtenThisTurn`, derived from the notes still `pending` — i.e. not yet
  folded into an earlier user turn — at the point this turn's `answerInThread`
  call is built, replaces `written` in the "nothing proposed and nothing
  written, so a 'saved' claim is false" check. A write note only lands in
  `pending` when the press that produced it was the immediately preceding
  thing that happened, which is exactly the one case a plain "it's saved"
  sentence is honestly describing.
- `lib/whatsapp/acknowledge.ts`: `isAcknowledgement` gained a narrow
  widening — a first word (case-folded, repeated letters collapsed: "jaa" →
  "ja") that matches a `wa.yes` phrase counts, so "jaa gerne" and "yes please"
  are read correctly while "jamais" and "yesterday was nice" are not. The
  exact-list match is unchanged and still the base case.
- `lib/whatsapp/dispatch.ts`: a miss at the consent gate now gets one short
  reminder (`wa.consentReminder`, new key, en/de/hu), said once per number via
  the existing `toldOnce.ts` marker — not total silence, and not repeated on
  every subsequent miss.

## Acceptance

- `test/whatsapp-proposal-press.test.ts` ("a typed press — B1302"): typing a
  proposal's button label, or its full accept sentence, or the decline word
  presses/declines it without a model call; unrelated text with a proposal
  still waiting reaches the model as before.
- `test/whatsapp-acknowledge.test.ts`: the gate now sends one reminder (not
  silence) on a miss, and not a second one on a further miss; lenient
  first-word matching covers "jaa gerne"/"yesss please" and correctly misses
  "jamais"/"yesterday was nice".
- `test/helper-honesty-per-turn.test.ts`: a write two turns back does not
  make a later, unrelated "it's saved" claim true (caught, retried, answered
  honestly); a claim made on the turn immediately following the real press is
  still left alone.
