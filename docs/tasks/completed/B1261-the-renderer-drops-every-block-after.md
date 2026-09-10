---
id: B1261
title: The renderer drops every block after the first interactive one, and the thread remembers what was never sent
type: ISSUE
priority: high
complexity: medium
area: whatsapp, helper
found: "2026-09-10T10:05:59Z"
merged: "2026-09-10T10:35:14Z"
completed: "2026-09-10T15:12:39Z"
---

# B1261 — The renderer drops every block after the first interactive one, and the thread remembers what was never sent

## Why

scenario-ctxloss.md reproduced a live failure end to end: "make me a draft
for tomorrow" on a one-trip journal made the model call `trips` (a read tool
that unconditionally draws a `choose` trip-picker whenever it finds at least
one trip, `lib/helper/tools/areas/trips.ts:33-45`) and `start_day` (which
drew its own `form` proposal) in the same turn. `lib/whatsapp/render.ts`'s
old `renderForWhatsapp` returned the **first** interactive shape it met and
silently dropped everything after it — Meta's real ceiling is one
interactive element per *message*, not per *turn*, and the old code treated
them as the same limit. The person was shown an unrelated trip-choice
button; the real `start_day` proposal and the model's own explanatory
sentence never reached the phone at all, and pressing the stray button
produced a non-sequitur the model had no live question to match it to —
the honesty guard then caught the model's own confused first attempt to
recover, matching the "Ich verstehe nicht ganz" class of live symptom this
scenario was scoped from.

`lib/whatsapp/dispatch.ts:661` (old line) then made it worse: `remember()`
stored `thread.answer` — the model's full, undropped prose — into the
conversation's own history regardless of what actually reached the screen.
Every later turn reasoned from a text the person never read.

scenario-guards.md's finding 2 is the same defect from the other direction:
a turn that calls **two** write tools draws two `confirm`/`form` blocks, and
the old renderer's single-message design meant only the first ever got a
button; the second was silently indistinguishable prose, and the model's own
sentence ("confirm **beide** Vorschläge") claimed a button existed for
something the person could never press.

## Work

**`lib/whatsapp/render.ts`** — `renderForWhatsapp` now returns an ordered
`WhatsappMessage[]` rather than one `WhatsappOutbound`. It walks `blocks`
once: plain shapes (`say`, `link`, `preview`, `files`, an over-long
`choose`, a `form`) accumulate into a running body; a `choose` that fits in
buttons or a list, or a `confirm`, flushes that body plus its own sentence
as one message and resets accumulation for whatever follows. Nothing from
`blocks` is dropped any more. A message built from a `confirm`/`form`
block's own `proposal` is tagged with it (`WhatsappMessage.proposal`), so a
caller can tell which message a proposal's buttons live on without
re-deriving it. Past `MAX_MESSAGES` (3) in one turn, `capMessages` keeps the
first two, always keeps the last (the message most likely to carry the
turn's own proposal, per how `blocks` is built — reads, then the write, then
the model's trailing prose), and folds anything strictly between into one
honest link-out line rather than sending it or silently eating it.

Fold-in fixes named in the ticket:

- **`truncate` now cuts at a word boundary.** The dayflow report found
  "Für mich ausformuli…" and "Diesen Text speiche…" — mid-word truncation on
  every non-trivial confirm label. It now finds the last space inside the
  budget and cuts there, falling back to a hard cut only for a single word
  longer than the whole budget.
- **`lib/helper/tools/areas/trips.ts`'s picker is honest again.** Its own
  `block()` is unchanged (still server-agnostic about the caller), but
  `lib/helper/model.ts`'s `rounds()` now buffers `trips`' own drawn blocks
  per round and only pushes them once the round is known to have produced
  no write proposal — ctxloss finding 1's own condition: a round that lists
  every trip *and* proposes a write has, by definition, already decided
  which trip the write is for, and showing the picker beside the proposal
  asks an already-answered question.

**`lib/whatsapp/dispatch.ts`** — `answerOnWhatsapp` now:

1. Transforms any `confirm`/`form` block belonging to a proposal *other
   than* `thread.proposals[0]` into plain `say` prose with an honest
   next-step (`wa.secondProposalNote`, new locale key) before rendering —
   `lib/whatsapp/pendingProposal.ts`'s one-proposal-per-number store is
   unchanged (a queue was considered and rejected: the store's own doc
   already states "a person is only ever shown one waiting write at a
   time," and a tap on a button for anything else would find nothing
   waiting regardless of how many are held), so only the first proposal
   ever gets real buttons; the rest are described in words rather than
   drawn as buttons a tap could never find.
2. Calls the new array-returning `renderForWhatsapp`, passing a translated
   `moreText` (`wa.moreInThread`) for `capMessages`' own honest overflow
   line.
3. Holds the primary proposal against whichever message carries its
   `.proposal` tag (a `confirm`-shaped proposal draws its own message); a
   `form`-shaped proposal draws no message of its own (see the module doc —
   `form` only ever folds into running prose), so it upgrades the *last*
   message to real buttons instead, exactly as the pre-B1261 code did for
   the single-message case.
4. Sends every message in the array, in order.
5. `remember()` and `recordTurn`'s own `answered` field now store the
   **joined bodies of what was actually sent** (`messages.map(m =>
   m.body).join("\n\n")`), not `thread.answer` — the model's own history and
   the operator's diagnostic log both now match what the person's screen
   actually showed, including a `capMessages` overflow note when one fired.

**`lib/whatsapp/reply.ts`** — found while testing this: `sendDryRun`'s
filename was `${isoStamp}-${maskedNumber}.json`, with millisecond
resolution. A single turn now routinely sends more than one message in a
row, and two synchronous writes inside one event-loop tick reliably land in
the same millisecond — the second silently overwrote the first on disk. A
dry-run-only bug (the real Cloud API path never touches this file), but real
enough to lose a reply in every local run and to break two existing tests
the moment this ticket made multi-message turns common. Fixed with a
per-process sequence number in the filename.

## Acceptance

`test/whatsapp-render.test.ts` — the whole shape vocabulary, now over
arrays: `say`/`link`/`preview`/`files`/`form`/an over-long `choose` still
produce one message each; `choose` under the button/list ceilings and
`confirm` still draw buttons/lists correctly; a new "two interactive shapes
in one turn" case (the ctxloss reproduction, in miniature) asserts both
arrive as separate messages in order, nothing dropped; a "more than the cap
allows" case asserts the honest collapse; a truncation case asserts a
`ausformulieren`-length label cuts at a word boundary.

`test/helper-trips-picker.test.ts` (new, its own file rather than folded
into `test/helper-honesty.test.ts` — that file's shared in-memory rate
limiter was already close to its ceiling and two more `POST /ask` calls
tipped it into unrelated `429`s): `trips` called alongside a write proposal
in the same round draws no picker; called alone, it still does.

`test/whatsapp-proposal-press.test.ts` — "two interactive shapes drawn in
one turn": both messages arrive and `remember()`'s own record of the thread
contains every body the person actually saw. "a turn that proposes twice":
exactly one message ever carries real buttons, its buttons never mention
the second proposal, and the second proposal's own sentence is present as
honest prose with a next-step rather than as a stray, unpressable button.
