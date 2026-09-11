---
id: B1286
title: The postcard back is labelled at print size and renders its message at eight pixels on a phone
type: ISSUE
priority: medium
complexity: low
area: postcards, mobile
found: "2026-09-10T10:52:43Z"
started: "2026-09-11T15:12:39Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:12:39Z"
---

# B1286 — The postcard back is labelled at print size and renders its message at eight pixels on a phone

## Why

Step 2 of the postcard flow shows the back of the card under the caption **"The
back, at print size"**. Measured at 390×844 on fernscout.ch:

| | |
| --- | --- |
| rendered card | 358 × 298 px |
| a real A6 postcard | 148 × 105 mm ≈ 560 × 397 css px |
| **message font size** | **8.16px** |

So it is about 64% of print size, not print size, and the message — the thing the
person came to this step to check — is rendered at eight pixels. It is a grey
smudge on the screen; the same words are legible in the editable field 200px
further down, which is where anybody actually reads them.

Two separate faults, and the second is the one that matters.

**The caption is untrue on a phone.** "At print size" is a promise about scale
that only holds on a wide screen. It was presumably true when written.

**The preview cannot be read.** This page is the last thing between the owner and
twenty credits of real print, and AGENTS.md is explicit about what it is for:
*"The owner opens that page, sees the photograph, the message on the back, who
each card is going to, the cost and their balance, and presses one button."* A
preview that cannot be read does not let them see the message on the back.

The address block has the same problem and matters less — it is printed by the
post office anyway, as the page says.

## Work

- Decide what the preview is for at this width. Showing the layout at a
  *readable* scale, with the caption saying it is not to scale, is honest and
  useful; showing it at true print size with horizontal scroll is the other
  honest answer.
- Whatever is chosen, the caption has to match what the reader is looking at at
  the width they are looking at it.

## Acceptance

- At 390px the message on the card preview renders at a legible size.
- No caption claims print size unless the rendering is at print size.
