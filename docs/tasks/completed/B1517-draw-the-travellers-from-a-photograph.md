---
id: B1517
title: Draw the travellers from a photograph the owner already has
type: FEATURE
priority: medium
complexity: medium
area: api, travellers, credits
found: "2026-09-11T19:55:00Z"
started: "2026-09-11T20:56:31Z"
merged: "2026-09-11T21:31:32Z"
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

## Built

`POST /api/v1/{user}/trips/{trip}/travellers/from-photo` —
`app/api/v1/[user]/trips/[trip]/travellers/from-photo/route.ts`.

- **Three doors in, same as `.../media`**: multipart bytes under `photo`, an
  `inbox` id (`findInboxFile`, already scoped to this journal), or a `gallery`
  src (`resolveMediaFile`, checked against the trip in the URL — a src naming a
  *different* trip in the same journal is refused `not_this_trip`, not silently
  read). No fourth door that fetches a URL: unlike `.../media`, this call
  stores nothing, so a URL door would be a way to spend this journal's credits
  classifying a stranger's photograph. A fresh upload is resized in memory
  (`resizedBuffer`, new in `lib/media.ts`) and never written to disk.
- **The classifier** is `classifyTravellers` in `lib/helper/model.ts`, beside
  `describePhotos` — same shape (Anthropic structured output, `book()`ed usage,
  throws on failure so the route can refund). Its schema enumerates every
  value `lib/travellers/vocabulary.ts` allows, plus `""` for "the photograph
  does not answer this". There is no `for` field in the schema at all, so
  nothing here can tie a figure to `people:`.
- **A claim is checked against the vocabulary, not trusted on the model's own
  say-so**: `TRAVELLER_FIELD_VALUES` re-validates every field after the model
  answers (AGENTS.md's "a claim is checked against the turn, never the
  phrasing"), and `unanswerable` is *computed* from what came back empty or
  out-of-vocabulary, never read from a self-reported list.
- **Children**: classified exactly like every other figure — the same four
  broad `age` buckets, nothing more specific, and the system prompt says so
  explicitly ("no estimated age in years, no guess at who a child belongs
  to"). This was the one judgement call the ticket flagged as needing to be
  deliberate; the decision is to apply one rule uniformly rather than carve
  out different handling for a child's face, since a coarser age bucket and
  the existing no-identification rule already cover the sensitivity without
  a second code path to keep honest.
- **Reused rather than duplicated**: `renderPartySvg` is a new export in
  `lib/travellers/render.ts`, factored out of `.../travellers/preview`'s inline
  SVG-building so both routes call the one renderer (the preview route was
  refactored to use it too — no behaviour change there).
- **Credits**: flat `TRAVELLERS_FROM_PHOTO_CREDITS` (2) per call regardless of
  party size, spent before the model call and refunded on failure — new
  `SpendReason`/ledger reason `travellers_from_photo`, new `Operation` of the
  same name for the admin usage chart.
- **Gates**: `mayWriteTrip` (any credential that may write this trip, not
  owner-only — this is cosmetic like `PATCH .../travellers`, not a `people:`
  change), `isEnabled("helper", user)`, and `hasHelperConsent(user, "photos")`
  — the same photos-consent scope `describe_photos` asks for, since this is
  the same promise: a photograph of people going to a model.
- **Contract**: full operation in `lib/api/openapi.ts` (request/response
  schemas, six refusal codes), new entries in `lib/api/errorCodes.ts`
  (`expected_photo`, `not_this_trip`, `idempotency_conflict`,
  `helper_unavailable`, `consent_required`, `model_failed`), and
  `test/credits.test.ts`'s `REFUND_ALLOWED` allowlist updated for the new
  route.

## Verified

- `npm run verify` — full build, tsc, eslint, vitest (541 files / 7069 tests),
  knip — all green.
- `test/travellers-from-photo.test.ts` (15 tests, route-level, model mocked):
  consent and capability gates; a gallery src naming a different trip refused;
  an unknown inbox id refused; all three input doors (gallery/inbox/multipart)
  accepted; a fresh upload never lands on disk; the trip's `trip.md` is
  byte-for-byte unchanged after a call; response carries `party`, `preview`
  (real SVG), per-figure `unanswerable`, no `"for"` anywhere in the response;
  flat credit charge regardless of party size; refund on model failure;
  `no_credits` refuses before the model is called.
- `test/travellers-photo-model.test.ts` (6 tests, `classifyTravellers`
  directly, Anthropic SDK mocked): a fully-answered figure round-trips with no
  unanswerable fields; empty strings read as unanswered; **a value outside the
  published vocabulary is silently corrected to unanswered rather than
  written** (the acceptance line "every value inside the published
  vocabulary", proven against a model that violates it, not just one that
  cooperates); nothing can produce a `for`; more figures than `MAX_FIGURES`
  are truncated; the system prompt's child-handling language is present.
- Per acceptance line: party-shape + vocabulary — proven by the
  out-of-vocabulary test above. Nothing written — proven by the byte-for-byte
  `trip.md` check. Preview + face↔figure + unanswerable — proven in the
  route test (`figures[].position` is the left-to-right index, `unanswerable`
  named per figure). Credits charged and reported — proven (`spent` field,
  balance debited, refund on failure). Refused when not from this journal —
  proven for a cross-trip `gallery` src and an unknown `inbox` id.

Not independently checked in a browser: this is a bearer-token API route with
no page of its own, so there is nothing for `test-in-a-browser` to drive —
verification is API-level, per AGENTS.md's note on tickets whose acceptance is
about API state rather than a rendered page.
