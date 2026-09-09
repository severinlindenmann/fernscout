---
id: B767
title: The helper's first screen asks a person to make four decisions before they have done anything
type: FEATURE
priority: high
complexity: medium
area: agent, ui, credits
found: "2026-09-07T14:04:47Z"
started: "2026-09-07T14:05:15Z"
merged: "2026-09-07T14:29:47Z"
completed: "2026-09-09T16:45:45Z"
---

# B767 — The helper's first screen asks a person to make four decisions before they have done anything

## Why

The owner looked at `/agent` on the live instance and said it already feels
overwhelming — and the person this whole feature was built for is somebody
older, not technical, holding a phone. On today's screen, before they have done
anything at all, they are offered:

1. a text box under a mono uppercase label, `WAS MÖCHTEST DU TUN?`
2. a full-width **Fragen** button
3. a second full-width button, **Zum Sprechen halten · 1 Guthaben pro 5 Minuten**
4. a language select, already set to **Schwiizerdütsch**
5. an **UNFERTIG** panel
6. a **Weitermachen** button

Six controls, four of them competing for the same tap, and two of them asking
for a decision nobody has any basis to make yet. The one thing they came to do
— write about their day — is not on the screen as a thing to press.

Three specific faults, in the order they hurt:

**The price is in the button.** *"Zum Sprechen halten · 1 Guthaben pro 5
Minuten"* puts a meter on the control before it is touched. It came from the
right instinct — B684's rule that a price is stated before the tap — and
overshot: stating a cost is not the same as making cost the loudest word on the
button. The person reads a taxi meter, not an invitation to talk.

**A technical choice comes first.** The spoken-language select (B686) is the
right mechanism and the wrong placement. It is only meaningful once somebody
has decided to speak, and its default is already correct — it comes from the
journal. Offered up front, it is a question about ASR language codes wearing a
friendly label.

**Nothing is primary.** Three controls of equal weight is three decisions. A
first screen should have one obvious thing to press and everything else quieter
than it.

## Work

**One primary action.** The bright yellow button says what the person came to
do — *Einen Tag schreiben* — and it is the only bright thing on the screen. If
a draft is unfinished, that button becomes *Weitermachen* and names the day; a
person with unfinished work does not want a second decision.

**The ask box goes quiet and second.** One line, sentence case, no mono
uppercase heading: *Oder frag mich etwas* — expanding to the box on tap. The
microphone becomes an icon inside that box, not a full-width button of its own.

**Prices leave the buttons.** No credit count in any label on this screen. A
cost is shown at the moment of spending, in the panel that confirms it — which
is where B684 and B687 already put it and where it belongs. The balance itself
moves off the first screen entirely: it earns a line only when it is low enough
to matter (*"Noch 3 Guthaben"*), and otherwise lives on the account page.

**The language select moves into the recording panel**, appearing once
recording has been chosen, still defaulting to the journal's language. A person
who never speaks never sees it.

**Plain words.** `WAS MÖCHTEST DU TUN?` and `UNFERTIG` are labels written for
somebody who reads interfaces for a living. Sentence case, ordinary German:
*Nicht fertig geworden* over a list of days.

Not doing: any change to what the wizard itself does, or to what anything costs.
This is the first screen and the words on it.

## Acceptance

On `/agent/<user>` at 390px, a person who has never seen it can tell in one
glance what to press. Exactly one control is visually primary. No price appears
on any button on that screen, and the balance is absent unless it is low. The
spoken-language select does not appear until speaking is chosen. Checked in a
browser, in German, by somebody who did not build it.
