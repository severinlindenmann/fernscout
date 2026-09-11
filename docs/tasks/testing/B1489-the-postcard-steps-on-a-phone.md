---
id: B1489
title: The postcard steps on a phone are nothing like the drawing they were approved from
type: FEATURE
priority: high
complexity: high
area: postcards
found: "2026-09-11T16:50:27Z"
started: "2026-09-11T18:11:36Z"
merged: "2026-09-11T18:17:14Z"
---

# B1489 — The postcard steps on a phone are nothing like the drawing they were approved from

The approved drawing has four phone screens for a postcard order and the site
matches none of them: the stepper pills with `1 of 3`, the card preview in its
frame with the closer slider, the back with `What it says` as a legend on the
card, `Saved` and `Undo my changes`, the recipients as rows with initials, the
price card, the coral warning, and a full-width press.

What ships is the same six controls in a plain column with a form beside a
preview — it works, and it is not what was approved.

## Work

`PostcardSteps`, `PostcardCropper` and `PostcardBack` to the drawing at 390:

- step pills, current one filled, `n of 3` on the right;
- `Look`: the card in a bordered frame, the slider as a labelled row beneath it,
  `Reset` and `Looks right`;
- `Write`: the back at print size with the message pane as a *field* — legend,
  focus ring, caret — then `Saved` and `Undo my changes`, and `Signed` /
  `Written in` / the figures switch as a card of rows;
- `Send`: recipient rows with initials, the shared price card, the coral
  warning, a full-width button.

**Nothing about saving, cropping or spending changes.** The debounce, the crop
POST and the single send route are untouched; this is markup.

## Acceptance

The four screens at 390 match the drawing frame for frame. Editing still saves
on the debounce, the crop still persists, and `test/postcard-send-flow.test.tsx`
is green.