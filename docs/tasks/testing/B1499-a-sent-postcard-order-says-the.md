---
id: B1499
title: A sent postcard order says the cards are Shipped, and nothing has ever told us that
type: ISSUE
priority: high
complexity: low
area: postcards
found: "2026-09-11T18:30:44Z"
started: "2026-09-11T18:31:41Z"
merged: "2026-09-11T18:47:06Z"
---

# B1499 — A sent postcard order says the cards are Shipped, and nothing has ever told us that

## Why

A sent order shows a **green** pill reading *Verschickt* / *Shipped*, and a
sentence saying the cards have gone to the printer. Green on this palette means
done, and "shipped" means it left the building.

**Nothing has ever told us either.** Stannp sends no webhooks — there is no
delivery event, no tracking number, no confirmation that paper was even
printed. What this instance actually knows is that a request was accepted by a
provider. Saying more than that on somebody\x27s receipt is the same fault
AGENTS.md opens with: the words on the screen are all a person has, and a
sentence that cannot be checked must not be stated.

It reuses `photobook.print.status.shipped`, which is a *photobook* status — and
there it is earned, because Gelato reports it and B1440 stores the parcels it
names.

## Work

A postcard order that has been sent reads as **with the printer**, in the tone
this palette uses for something in progress rather than something finished. Its
own key, not the photobook\x27s: the two providers tell us different things and
one string for both is how a claim gets borrowed.

The sentence under it says what is true and what follows — accepted by the
printer, on their way in the days after — without naming a day nobody promised.

German and Hungarian as well, and real ones.

## Acceptance

No green pill and no word meaning "delivered" on a postcard order anywhere in
the three languages; the photobook status vocabulary is untouched.