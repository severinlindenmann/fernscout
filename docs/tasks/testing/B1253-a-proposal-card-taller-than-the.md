---
id: B1253
title: A proposal card taller than the phone opens scrolled past its own explanation, mid-sentence
type: ISSUE
priority: medium
complexity: low
area: helper, mobile
found: "2026-09-10T09:51:30Z"
started: "2026-09-11T06:40:31Z"
merged: "2026-09-11T08:13:13Z"
---

# B1253 — A proposal card taller than the phone opens scrolled past its own explanation, mid-sentence

## Why

The helper's day proposal is 587px tall. At 390x844 the room auto-scrolls to the
newest message, which puts the card at **y = -108** inside a scroller whose top
is at y = 73 — so 181px of it, the whole top of the card, is above the fold when
it arrives. What the person sees first is a sentence cut through the middle of
its glyphs:

> ~~Chan~~ge one now, or tell me a real figure afterwards.

Above that line, and never seen, is everything that explains the card:

> ✏️ A change — A day for 2026-09-05 in Bern Weekend. It starts empty; the words
> and the photographs come after. The questions below open on "Nobody has it" —
> nothing is invented, nobody has been asked yet.

That paragraph is the answer to the two questions the card raises on sight —
*what is this* and *why do both dropdowns say "Nobody has it"* — and it is the
one part scrolled away. The person is left with two selects reading "Nobody has
it" and a dark **Start this day** button, which is a decision taken without the
sentence that framed it.

Auto-scrolling to the newest message is right for a reply. It is wrong for an
interactive card that is taller than the screen: the top of the card is the part
that matters, and every proposal in this room has this shape.

Measured on fernscout.ch, 2026-09-10; screenshot `13-proposal.png` from the run.

## Work

- When the newest message contains an interactive card, scroll its **top** into
  view rather than the bottom of the message.
- Whatever the rule, no message should come to rest with the scroller cutting a
  line of text in half — the card's own top padding should land below the header.
- Check it against the other cards the room can produce (publish, costs,
  photographs), not only the day proposal.

## Acceptance

- At 390x844, sending a message that produces a day proposal leaves the card's
  first line fully visible: `card.getBoundingClientRect().y >= scroller.getBoundingClientRect().y`.
- The buttons are still reachable by scrolling down, with no jump.
