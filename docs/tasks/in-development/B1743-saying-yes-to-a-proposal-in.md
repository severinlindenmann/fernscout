---
id: B1743
title: Saying yes to a proposal in the web room presses nothing, and the guard then denies the card exists
type: ISSUE
priority: high
complexity: medium
area: agent room
found: "2026-09-14T16:48:46Z"
started: "2026-09-14T16:52:38Z"
session: 47321abb-ce05-46ca-8dfe-58c5b70fa908
claimed: "2026-09-14T16:52:38Z"
---

# B1743 — Saying yes in the web room presses nothing, and the guard denies the card

## Why

fernscout.ch, 16:47 today. A `trip_people` proposal for Viktória Zentai on
Ungarn 2026 had just been drawn, with its card and its button on screen. The
owner typed **"ja"**. What came back:

> Es wurde nichts gespeichert und in deinem Journal hat sich nichts geändert —
> es wartet nichts auf eine Bestätigung. Sag es noch einmal, oder sag mir,
> welche Reise und welchen Tag du meinst, dann lege ich dir etwas zum
> Bestätigen hin.

"Nothing is waiting for a confirmation", said while a card waiting for a
confirmation is visible above it. The `guard` column on that row reads
`claim`, so this is an honesty guard firing — the guard is doing its job,
and the sentence it substitutes is simply false about the screen.

Nothing was written: `ungarn-2026/trip.json` still has no Andreas, and the
Viktória row on it predates this exchange.

**The asymmetry is the cause.** B1302 gave WhatsApp a typed press —
`lib/whatsapp/dispatch.ts:378` reads a typed accept label against
`pendingProposal` *before* the words ever reach a model. The web room has no
equivalent: `components/HelperAsk.tsx` presses only when its button is
clicked, so "ja" is an ordinary message, reaches a model that holds no
handle on the waiting card, and the guard catches the model's attempt to
claim it did something.

**Corrected by the owner, 2026-09-14:** the first draft of this ticket said
the owner had been taught to type "ja" by the WhatsApp side. They had not —
they did not know the typed press existed. That makes this worse, not better.
Typing "yes" under a card that asks a yes/no question is simply what a person
does; it needs no prior training, and the answer it gets is a flat denial that
the card is there.

## Work

- Decide which of the two doors is right. Either the web room learns the same
  typed press WhatsApp has, or the guard's sentence stops denying a proposal
  that is on screen. The first is the better product; the second is the
  smaller change and is needed regardless, because the sentence is wrong
  whenever a card is up.
- If the typed press comes to the web, it is `lib/whatsapp/dispatch.ts`'s
  logic and not a second implementation — the shared half belongs somewhere
  both doors read.

## Acceptance

- With a proposal on screen in the web room, typing the accept word either
  presses it or is answered with something true about what is waiting.
- No answer says "nothing is waiting for a confirmation" while a card is
  rendered.
