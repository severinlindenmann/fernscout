---
id: B451
title: The postcard preview prints the message at four times its real size
type: ISSUE
priority: high
complexity: low
area: postcards, preview page
found: "2026-09-05T15:10:00Z"
started: "2026-09-05T12:47:21Z"
session: 8af79b62-fe04-4cc3-b94b-9609f44a5f9d
claimed: "2026-09-05T12:47:21Z"
---

# B451 — The postcard preview prints the message at four times its real size

## Why

On `/<user>/postcards/<id>` the message fills the whole left half of the card
in letters about a centimetre tall — five words to a card. On paper it is 10pt
and the same words take one line. The preview's entire claim is that what is on
screen is what is on the paper, and it is the first thing anybody sees.

The cause is one word in `app/[user]/postcards/[id]/page.tsx`. The message is
sized in `cqw` — a percentage of the container-query container — and
`containerType: "size"` was set on the `<p>` itself rather than on the card
`<div>` around it. So `2.4cqw` resolves against the paragraph's own width
(about 46% of the card) instead of the card's, and the text is roughly twice
the size it should be while also depending on itself.

The number was right: `render.ts` draws the message at `messageSize = 10` on a
bleed box 154mm = 436.5pt wide, which is **2.29%** of the card width.

## Work

- Move `containerType: "inline-size"` onto the card container and take it off
  the `<p>`.
- Stop hardcoding `2.4` in the page. `messageSize = 10`, the signature's `8`
  and the `1.45` leading are locals in `lib/postcard/render.ts`; `preview.ts`
  promises it draws from the same constants as the renderer and this is the
  one place it does not. Move the three into `lib/postcard/spec.ts` beside the
  other print geometry, import them in both, and have `backLayout()` derive
  the percentages.
- While there: the address block renders as an empty dotted rectangle. Draw the
  recipient's lines into it faintly, as `render.ts` does — a proof of the back
  that omits the address is not proving the half that gets it delivered.

## Acceptance

- The message in the preview occupies about the same fraction of the card as
  in the PDF: a sentence that wraps to one line on paper wraps to one line on
  screen.
- A test asserts the font percentage is computed from the spec rather than
  written down — changing `MESSAGE_PT` moves the preview too.
