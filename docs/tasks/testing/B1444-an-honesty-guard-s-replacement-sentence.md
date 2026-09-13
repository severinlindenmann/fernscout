---
id: B1444
title: An honesty guard's replacement sentence is rendered twice around the card it replaces
type: ISSUE
priority: medium
complexity: low
area: helper, room
found: "2026-09-11T11:11:05Z"
started: "2026-09-13T07:06:34Z"
merged: "2026-09-13T07:10:52Z"
---

# B1444 — An honesty guard's replacement sentence is rendered twice around the card it replaces

## Why

Found in a live owner session on fernscout.ch, 11 September 2026.

An honesty guard fired correctly — a turn claimed a day was there to act on
when none existed — and the replacement sentence was rendered **twice**, once
above the card and once below it:

```
There is no day in your journal for that date yet, so nothing has been saved
and there is nothing to press. Start the day first, and then this can go on it.

Trips in this journal
  Japan, end to end          28 March – 9 May
  Across and back            1 June – 20 November
  …

There is no day in your journal for that date yet, so nothing has been saved
and there is nothing to press. Start the day first, and then this can go on it.
```

The guard itself is right and is **B1323** working as built; this is only how
its sentence is placed. But a sentence that a person is meant to trust, printed
twice, reads as the software being confused — which is the opposite of what the
net in `lib/helper/model.ts` is for.

This is **not B1256**, which is fixed: the card outcome ("The day is started. It
is a draft, so nobody but you can read it.") appeared exactly once in the same
session. The duplicate here is the guard's replacement text, rendered as both
the turn's message body and the card's own caption.

## Work

Find where a guarded turn's text reaches both the message list and the card, and
render it once. Check whether an ordinary (unguarded) turn with a card has the
same shape and simply has two different strings, which would hide it.

## Acceptance

- A guarded turn that also carries a card shows its sentence once.
- `test/helper-honesty*.test.ts` still passes, and one of them asserts the count
  rather than only the wording.

## Revalidated — 2026-09-13

Still valid on current `main`: helper turn rendering can include the guard's
replacement text as the message body and again as the card caption. The task
has a focused acceptance condition and requires no product decision.

## Implemented

Proposal turns now suppress an identical plain `say` block when its sentence is
already rendered by the proposal card. Different prose and ordinary cards are
unchanged. The helper chat test asserts the guarded sentence appears exactly
once.

## Verification

- Helper chat and honesty tests — 225 passed.
- `npm run build` — pass (existing Turbopack filesystem warnings remain).
- `npx tsc --noEmit` — pass.
- ESLint — 0 errors (existing warning only).
- `npm run unused` — pass (existing configuration hints only).
