---
id: B627
title: A portrait photograph on a postcard is centre-cropped with no way to choose the crop
type: FEATURE
priority: medium
complexity: medium
area: postcards, photo crop
found: "2026-09-06T17:51:43Z"
started: "2026-09-06T18:39:47Z"
merged: "2026-09-06T19:00:20Z"
completed: "2026-09-07T13:12:35Z"
---

# B627 — A portrait photograph on a postcard is centre-cropped with no way to choose the crop

## Why

Most photographs on a phone are portrait; a postcard is landscape. Today the
picture is centre-cropped to fill, which is the one crop nobody asked for — a
person's head above the frame, a horizon in the wrong third. The owner sees the
result on the preview page (`/<user>/postcards/<id>`) and has no way to change
it short of cropping the file before it was uploaded, which is not something an
agent-written journal makes easy.

## Work

- On the postcard preview, let the owner drag the frame over the photograph and
  save the chosen crop. Not a full editor: pan within a fixed aspect, and
  nothing else.
- The crop belongs with the proposal, not with the photograph — the same
  picture on another card, or in the gallery, is untouched.
- Never scale a photograph anisotropically; the existing crop-to-fill is
  correct in that respect and stays.

## Acceptance

- A portrait photograph proposed as a postcard can be repositioned before
  sending, and the printed PDF uses the chosen crop.
- The gallery copy of the same photograph is unchanged.

## What was found and built

**Preview and print did share one crop calculation already being missed,
because the preview never called a crop function at all** — it was a plain
`<img className="object-cover">` with no `objectPosition`, i.e. always
CSS-default centre, while `lib/postcard/render.ts`'s `coverRect()` computed
its own (also always-centre) rectangle independently. Two centre-crops that
happened to agree by coincidence, not by sharing code.

B513 had already solved the exact geometry problem for the photobook —
`lib/photobook/plan.ts`'s `cover()` — including the y-axis flip between a
top-left-origin drag point and PDF's bottom-up page space
(`(slot.height - height) * (1 - focal.y)`). That formula is reused verbatim
(same shape, same reasoning) rather than rederived:

- `lib/postcard/orders.ts`: `OrderPayload.crop?: Crop` (`{x, y}` fractions,
  B513's shape), `updateOrderCrop()` mirroring `updateOrderText()` (owner
  only, `draft`-only, clamped 0–1).
- `lib/postcard/render.ts`: `coverRect()` takes an optional `crop`, defaulting
  to `{x:0.5,y:0.5}`, using the same `(1 - crop.y)` flip as `plan.ts`'s
  `cover()`. `PostcardInput.crop` threads it through `renderPostcard`.
- `lib/postcard/send.ts`: passes `order.payload.crop` into `renderPostcard`
  at print time — the one and only place that turns an order into paper.
- `app/[user]/postcards/[id]/crop/route.ts`: new owner-only door, same shape
  as `message/route.ts` — refuses a bearer token outright, refuses once the
  order leaves `draft`. Answers JSON rather than redirecting (the drag control
  calls it by `fetch`, not a `<form>` submit).
- `components/PostcardCropper.tsx`: the drag control — pointer down/move/up
  pans a fixed-aspect frame (`backLayout().aspect`, the card's own ratio, so
  the same `object-fit: cover` box the PDF fills), arrow keys nudge by 5%,
  saves on release/keypress. Read-only render (no drag) once the order is no
  longer pending.
- Not under `/api/v1/`, so no `openapi.ts` change: an agent has no way to see
  its own drag, so — like `message` and `send` — this is refused to any
  request carrying `Authorization` and has nothing to document as a contract
  surface. Confirmed no existing `postcards/[id]/message|send` route appears
  in `lib/api/openapi.ts` either, which is the same shape.
- Tests: `test/postcard-orders.test.ts` (`updateOrderCrop` — absent-until-set,
  clamped, `draft`-only, owner-scoped) and `test/postcard.test.ts` (absent ==
  centre; never anisotropic — width/height unchanged by `crop`; the y-flip
  against a *portrait* photo specifically, since the shipped landscape fixture
  has no vertical slack to crop and would pass a broken flip silently; x is
  not flipped).
- `npm run verify` passes in full (build → tsc → eslint → vitest, 3929 tests).
