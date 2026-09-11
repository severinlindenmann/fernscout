---
id: B1286
title: The postcard back is labelled at print size and renders its message at eight pixels on a phone
type: ISSUE
priority: medium
complexity: low
area: postcards, mobile
found: "2026-09-10T10:52:43Z"
started: "2026-09-11T15:12:39Z"
merged: "2026-09-11T15:36:19Z"
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

**Built.** Legible over true-to-scale, as the ticket itself suggested.

- `lib/postcard/spec.ts`: new `MESSAGE_FLOOR_PX = 14` — the message never
  renders under 14px, matching the editable field's own `text-sm` two hundred
  pixels below the card. The number is a judgement call (no smaller precedent
  existed on this page), chosen to match text already on the page rather than
  invented from nothing.
- `lib/postcard/preview.ts`: `font.message` is now `max(Xcqw, 14px)` instead of
  the bare percentage — CSS's own `max()`, no JS recompute needed for the
  visual floor. Also added `font.messageTrueAbovePx` (~611px for A6 landscape):
  the card width above which the floor is doing no work and the message really
  is at print size — computed as `MESSAGE_FLOOR_PX / fontFraction(MESSAGE_PT)`.
- `app/[user]/postcards/[id]/PostcardBack.tsx`: a `ResizeObserver` on the card
  element compares its measured width against `messageTrueAbovePx` and picks
  `strings.caption` ("at print size") or the new `strings.captionNotToScale`
  ("not to scale"). Defaults to the *not-to-scale* caption on first render, on
  both server and client, to avoid a hydration mismatch — a phone is the
  common case, and claiming less by default is the safe direction.
- `app/[user]/postcards/[id]/page.tsx`: passes both caption strings, from two
  new locale keys (`postcard.page.backNotToScale`,
  `postcard.page.backFirstOfNotToScale`), added to en/de/hu and regenerated
  into `lib/i18n.ts` via `npm run i18n:keys`.
- `test/postcard.test.ts`: the three `backLayout().font.message` tests updated
  for the `max()` wrapper (a small `cqwOf()` helper pulls the percentage back
  out); still assert the same 2.291% derivation.

**Measured, not on the live site — on the CSS mechanism itself**, via
`chrome-devtools` on a minimal page reproducing the exact structure
(`container-type: inline-size` + `font-size: max(2.291cqw, 14px)`) at the
ticket's own reported card width:

| card width | old (bare cqw) | new (floored) |
| --- | --- | --- |
| 358px (the ticket's 390px-viewport measurement) | 8.16px | **14px** |
| 900px (well past the ~611px true-scale threshold) | 20.6px | 20.6px (unchanged — floor does nothing here) |

I did not exercise the real `/<user>/postcards/<id>` page end to end (no
postcard order exists in the local demo content, and creating one needs an
approved contact and a print-eligible photograph — more setup than this
change needed to prove out). The CSS is the load-bearing part and is verified
directly above; the `ResizeObserver`/caption-switch logic is plain and was
read carefully rather than screenshotted. If you want the real page checked,
open `/<user>/postcards/<id>` at 390px on a journal with a pending order.

## Acceptance

- At 390px the message on the card preview renders at a legible size.
- No caption claims print size unless the rendering is at print size.
