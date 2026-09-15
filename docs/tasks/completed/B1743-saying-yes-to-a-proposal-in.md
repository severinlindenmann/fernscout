---
id: B1743
title: Saying yes to a proposal in the web room presses nothing, and the guard then denies the card exists
type: ISSUE
priority: high
complexity: medium
area: agent room
found: "2026-09-14T16:48:46Z"
started: "2026-09-14T16:52:38Z"
merged: "2026-09-14T17:23:22Z"
completed: "2026-09-15T08:19:20Z"
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

**Valid**, revalidated 2026-09-14: the typed press lives entirely in
`lib/whatsapp/dispatch.ts:378`; `components/HelperAsk.tsx` pressed only on its
button's own click, so any typed word went to `/ask` and then to a model.

## Work — as built

`components/HelperAsk.tsx:ask()` now recognises a press before the request
goes out, the same order `dispatch.ts` does it in: no credit spent, no model
called. Two things count — the journal's own yes words and the proposal's own
accept sentence — against the newest turn's proposal only, because "yes" means
the thing on screen and not a card from twenty minutes ago.

`lib/phrases.ts` is the shared matcher, lifted out of
`lib/whatsapp/acknowledge.ts` so both doors ask one implementation. It is
deliberately **two** functions rather than one:

- `matchesPhraseList` — trimmed, case-folded, exact. This is all a press may
  use.
- `matchesFirstWord` — B1302's emphatic-first-word collapse ("jaa" → "ja"),
  which stays consent-only.

The split came out of writing the test: "ja aber erst den Titel ändern" — *yes,
but change the title first* — passes the collapse, and as a press it would
write the very version they had just said was wrong. Acknowledging a
disclosure and writing to somebody's journal are not the same risk.

**A destroy-shaped proposal is never typed-pressed.** Those draw a
`ConfirmPanel` and take two presses on purpose; a typed word must not be a way
around the second one.

## What the live check changed

The first version settled the card *before* awaiting the route. The browser
check caught it immediately: the route answered 422 and the card said
**"The trip is made."** — the exact claim AGENTS.md forbids, reached by
settling on the attempt rather than the outcome. It now settles only after the
route answers, and a refusal puts their word back in the box and shows the
same sentence a failed button press shows.

## Acceptance

- **A typed yes presses.** `/agent` at 390px, demo journal: a `trip_people`
  proposal accepted by typing "yes" settled to "They are on the trip, and may
  now write to it.", the buttons went away, and
  `content/example/trips/alps-2024/trip.json` gained the row.
  `/tmp/b1743-ok-before.png` and `-ok-after.png`.
- **No model call, no credit.** Three `/ask` calls in the dev log for three
  typed sentences and none for the three presses; the balance read 49'999.9
  before and after. The press itself was
  `PATCH /api/helper/example/trip/people 200`.
- **It is faithful to the button.** On a `create_trip` proposal that the route
  refuses (B1650's declinables), the typed press and a click on "Make this
  trip" produced the identical refusal and left the card pressable —
  `/tmp/b1743-before.png`, `-after.png`.
- **A sentence containing a yes is not a press** —
  `test/typed-press.test.ts`, including "ja aber erst den Titel ändern",
  "yesterday we walked to the lake" and "jamais".
- **No card can be pressed twice**: a typed press settles it.
- Not done, and out of scope: typing a *no*. "nein" still reaches the model,
  which is the honest pre-existing behaviour rather than a new half-mechanism.
