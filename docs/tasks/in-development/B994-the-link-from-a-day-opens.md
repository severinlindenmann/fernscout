---
id: B994
title: The link from a day opens a room that does not know what it was opened from
type: FEATURE
priority: high
complexity: medium
area: helper, ui
found: "2026-09-08T16:53:41Z"
started: "2026-09-09T20:47:09Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T20:47:09Z"
---

# B994 — The link from a day opens a room that does not know what it was opened from

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`components/HelperAskHere.tsx` sits under a day and on a trip, and says

> **Ask for anything else, in your own words**
> *Bitte um etwas anderes – in deinen eigenen Worten*

Two things are wrong with it, and the label is the smaller one.

**The words ask for effort.** "In your own words" is the sentence you write
when you have a blank text box and no idea what to put in it. What is on the
other end is an agent that could simply be told *"this day, please"*. The
label should say what it is — talk to your agent about this — and not set a
composition exercise.

**And the room it opens does not know what it was opened from.** The link
carries `?trip=…&slug=…`, which fills the *preview pane*: the day is drawn on
the right, and the conversation itself has never heard of it. So the first
thing a person has to do, having pressed a link on a day, is describe that day
to something that is already showing it.

## What it should do

Pressing it starts a **new conversation that already knows what it is about**,
and offers the things somebody standing on that page is likely to want:
rewrite the words, add a photograph, add a cost, take it off the site.

Two mechanisms exist for this and neither costs a model call:

- **A note** (B924) is a line written for the model and never shown: *"they
  came here from the day of 2026-05-01 in Alps 2026, and are looking at it."*
  That is what makes the first sentence they type answerable without their
  having to say which day.
- **A `choose` block** is one of the seven shapes the room already renders. It
  can be drawn locally, with no turn taken, so the offer appears instantly and
  pressing one sends it as the first message.

The result is that the page is the context, a person presses once, and the
conversation continues from there — which is what the room is for.

## Work

(As built, 2026-09-09:) `?about=` now forgets the live thread, writes the
B924 note naming the day, and opens a blank conversation whose first screen
is a locally-drawn offer — rewrite / add photographs / add a cost / take it
off the site — each press sending that sentence as the first message. The
room strips `about` from the address on mount so a reload resumes rather
than re-forgets, and the two links that carry `about` are `prefetch={false}`
so a viewport prefetch cannot wipe a conversation. The day row's label is
"Talk to your agent about this day" in all three languages. **Not done:**
a trip-level `about` — no link today carries a trip without a day; when a
trip page grows one, the same mechanism takes `?about=<trip>`.

- The label, in all three languages, and in `lib/i18n.ts`.
- The link starts a **new** session rather than continuing the last one, since
  it is about a particular thing. B984 is what makes a session addressable,
  so this waits for it.
- The room, opened with a page's context, writes the note and draws the offer.
- It appears wherever the component already does — a day and a trip — and the
  offer differs between them, because what you can do with a trip is not what
  you can do with a day.

Not doing: an automatic first turn from the model. It would cost a credit on
page load, for an offer the person may not want, and the whole point of the
`choose` shape is that it is free.

## Acceptance

From a day, one press reaches a conversation that names that day without
anybody typing it, and offers at least rewriting its words. The next sentence
is answered in that context. From a trip, the same, about the trip.
