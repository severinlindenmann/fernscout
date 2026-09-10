---
id: B1254
title: Reloading the helper loses every interactive card, leaving prose that points at one
type: ISSUE
priority: high
complexity: medium
area: helper, mobile
found: "2026-09-10T09:54:08Z"
---

# B1254 — Reloading the helper loses every interactive card, leaving prose that points at one

## Why

Reload `/agent` mid-conversation and every card in the transcript is gone. Only
the prose survives.

Before the reload the room held, in order: the trips card, the day proposal with
its date and two dropdowns, the started-day confirmation, and the "Write it up
for me" card with the notes in it. After the reload:

> You: On Saturday we walked through the old town of Bern…
>
> You haven't started any days on this trip yet. … Which date was the Saturday?
>
> You: The 5th.
>
> **A proposal for 5 September is on your screen.** The trip is set to ask for
> costs and coordinates each day — did you note how much the rosti cost…

It is not on the screen. The sentence that survived is now false, and it is the
sentence telling the person what to do next. There is no control anywhere in the
room to bring the card back; the only way forward is to describe the whole thing
again to the model, which costs a credit and may produce a second day.

A phone is where this happens. Backgrounding the browser, a notification, memory
pressure, the home-screen PWA being resumed — all of them reload the page, and
the room invites exactly that by offering *"Add Fernscout to your home screen…
it opens like an app."* An app that forgets what it asked you the moment it is
resumed is not one.

`lib/helper/model.ts` holds the net that stops the model saying something the
turn did not do. This is the same failure from the other side: the sentence was
true when written and the page made it false afterwards.

Found on fernscout.ch at 390x844, 2026-09-10.

### It gets worse one step further on

Carried on to the end of a day and reloaded again, the transcript's **last line**
was:

> A draft of 5 September is on your screen for you to read and press. It costs
> one credit when you do.

The credit had already been spent and the words were already saved — the card
that said so ("The words are saved", with *Put this day on the site*, *Add
photographs*, *Undo*) was gone, and the only surviving instruction is one that
invites the person to pay for the same day a second time. The reload does not
merely lose the controls; it leaves the transcript ending on an out-of-date
instruction with a price attached.

## Why it is not simply "re-render the cards"

Worth deciding deliberately: a card is a *pending decision*, and some of them
(publish, spend a credit) must not silently reappear as live buttons on a
transcript the person is only re-reading. Whatever is rebuilt has to distinguish
a card still awaiting an answer from one already answered or abandoned.

## Work

- Persist enough of each card with the conversation to rebuild it on load —
  the proposal's fields and their values, and whether it is still open.
- A card that was answered should come back in its answered state, not as a
  live button.
- An abandoned card should come back visibly closed rather than vanishing, so
  the prose around it keeps making sense.
- Where a card genuinely cannot be restored, the prose that referred to it must
  not survive as an instruction.

## Acceptance

- Drive the wizard to a day proposal, reload, and the card is still there with
  its date and both dropdowns as they were.
- Answer a card, reload, and it shows as answered rather than offering the
  button again.
- No sentence in a reloaded transcript refers to a card that is not on screen.
