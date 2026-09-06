---
id: B627
title: A portrait photograph on a postcard is centre-cropped with no way to choose the crop
type: FEATURE
priority: medium
complexity: medium
area: postcards, photo crop
found: "2026-09-06T17:51:43Z"
started: "2026-09-06T18:39:47Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T18:39:47Z"
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
