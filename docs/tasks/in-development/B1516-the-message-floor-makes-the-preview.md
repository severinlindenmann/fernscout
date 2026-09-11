---
id: B1516
title: The message floor makes the preview bigger than the card it is previewing
type: ISSUE
priority: medium
complexity: low
area: postcards
found: "2026-09-11T19:47:14Z"
started: "2026-09-11T20:06:24Z"
session: 3f748903-2dc3-47a2-a958-98b83d641dc0
claimed: "2026-09-11T20:06:24Z"
---

# B1516 — The message floor makes the preview bigger than the card it is previewing

## Why

B1286 gave the message preview a floor — `max(2.385cqw, 14px)` — so that on a
phone, where the card renders about 358px wide and the true size is 8.5px, the
words stay readable. The cost is that the preview is 65% larger than the card
it is previewing: a long message overflows the drawn back and is clipped
mid-word while fitting the real one perfectly, which B1511 had to paper over
by printing "it fits" underneath.

The owner\x27s answer, and it is the right one: **the preview is a preview.**
What it is for is seeing the shape of the card — where the words sit, how much
white is left, where the signature lands. What it is not for is reading the
message, because the field directly below it holds the same words at 16px and
is where anybody actually reads them.

## Work

Drop the floor. The message renders at its true fraction of the card at every
width, which also means the preview is always to scale — so
`messageTrueAbovePx`, the `trueScale` state it feeds in `PostcardBack`, and the
`captionNotToScale` string it switches to all go with it.

B1511\x27s fit line stays: it answers a question the picture still cannot, since
a clipped line looks the same as a missing one at 8px.

## Acceptance

The drawn back holds the same words in the same place as the printed one, at
390 and at 1280, and the caption says print size in both because it now always
is.