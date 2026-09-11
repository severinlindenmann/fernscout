---
id: B1258
title: The publish card says to read the day as readers will see it and does not show the day
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-10T09:59:55Z"
started: "2026-09-11T15:47:56Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:47:56Z"
---

# B1258 — The publish card says to read the day as readers will see it and does not show the day
## Why

The card that puts a day on the site opens with:

> 2026-09-05 — "Old town, bears, and Einstein". **Read it as your readers will
> see it.** Pressing puts it on the site. Anybody who finds it will be able to
> read it.

Nothing on the card is the day. It carries the date, the title, four more
sentences about photographs, one dropdown reading "Nobody has it", and the
button. The words the person is about to publish to anybody who finds them are
not there — asserted by measurement, not by eye: the card's text contains the
title and does not contain a single word of the body.

This is the one card where reading before pressing is the whole point. The
instruction is right; it is just addressed to a card that cannot satisfy it.

The day *is* readable — in the **How it looks** tab, one tap away. On a phone
that tab replaces the chat entirely, so following the instruction means leaving
the card, reading, and coming back to find it (and B1254 means a reload on the
way loses it). On a desktop the preview is beside the chat and the sentence is
true. It was written for that width.

Found at 390x844 on fernscout.ch, 2026-09-10; screenshot `18-publish-card.png`.

## Work

Pick one; both are small.

- Put the day in the card — title and words, in the card, above the button. Then
  the sentence is true at any width.
- Or make the sentence do the work it can do at this width: point at the preview
  explicitly, as a control on the card rather than as an assumption about the
  layout.

The second is smaller. The first is the one that means the consent is informed
without a tab change.

Not in scope: the "Photographs — Nobody has it" question on this card, which is
a separate argument.

## Acceptance

- At 390px, the publish card either contains the day's words or carries a
  control that opens them, and the sentence matches whichever is true.
- At desktop width nothing regresses.
