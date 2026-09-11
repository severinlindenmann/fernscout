---
id: B1517
title: Draw the travellers from a photograph the owner already has
type: FEATURE
priority: medium
complexity: medium
area: api, travellers, credits
found: "2026-09-11T19:55:00Z"
---

# B1517 — Draw the travellers from a photograph the owner already has

## Why

Proposed by an owner on 2026-09-11, straight after watching an agent do it the
long way.

`travellers` is a nine-field questionnaire per person — skin, hair, hairStyle,
eyes, outfit, shirt, pants, build, age, accessories — and `maxFigures` is 10. A
family of four is forty answers. Nobody wants to be asked forty questions about
what their children look like, and an agent asking them one at a time is worse
than the questionnaire.

But the answers are **already in the journal**. This trip had 177 photographs of
exactly two people, and the agent filled the block by opening two of them and
reading off what it saw: light skin, brown hair, short and long, blue and green
eyes, shorts and a dress. Two minutes, no questions asked, and the owner's
reaction was *"why did I have to ask for that"*.

The owner's framing, which is the right one: **upload a group photo of you and
your buddies, and the figures come back.** One picture, one call, a party.

The vocabulary makes this unusually tractable. Every field is a short closed
enum — six skin tones, eight hair colours, eleven styles, five outfits, eleven
cloth colours. This is classification into a fixed list, not open-ended
generation, so the output is checkable: anything outside the vocabulary is
already refused with `invalid_travellers`.

## Work

`POST /api/v1/{user}/trips/{trip}/travellers/from-photo`, taking an image the
same way media does — an upload, or an `inbox` id, or a `gallery` src already in
the trip. It returns a **proposed** party in the existing shape, and writes
nothing.

That last part is the whole design, not a detail:

- **Proposed, never written.** The response is a party plus the preview SVG the
  `preview` route already renders. The owner looks and then says yes. Writing it
  would make an inferred face into a fact about a person, and this repository's
  rule covers that even when the inference is good.
- **Say which face became which figure**, with a box or an index, so a party of
  five can be corrected one figure at a time rather than rejected whole.
- **No names, no `for:`.** The route matches nobody to an address. `for` ties a
  figure to `people:`, and that block is write access; an inference must not
  reach it.
- **Say what it could not tell.** A field the photograph does not answer — eyes
  at a distance, build under a coat — comes back absent rather than guessed, and
  the response says which. Absent is a perfectly good value and the questionnaire
  already treats it as one.

Costs credits, from the same balance as mail and WhatsApp, and the response says
what it cost. Price it per call rather than per face: a group photo is the point.

Worth thinking about before building:

- **A photograph of people is the most sensitive thing in the product.** It has
  to be clear that the picture is read and not kept, and the route should not
  accept a photo from outside the journal.
- Children are in the vocabulary (`age: child`) and in these photographs.
  Whatever is decided about inference on a child's face should be decided
  deliberately and written down, not left to whatever the model does.
- The existing `preview` route means there is already a way to show the result
  before it is written — this feature is mostly plumbing between that and a
  classifier.

## Acceptance

- One group photograph returns a party of figures in the `travellers` shape,
  every value inside the published vocabulary.
- Nothing is written to the trip by the call itself.
- The response carries the preview, says which figure came from which face, and
  names the fields it could not answer.
- Credits are charged and reported.
- A photograph that is not from this journal is refused.
