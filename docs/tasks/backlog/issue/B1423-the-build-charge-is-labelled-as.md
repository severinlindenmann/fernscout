---
id: B1423
title: The build charge is labelled as the print, so the panel names 40 credits for something that costs 165
type: ISSUE
priority: high
complexity: low
area: photobook, the ordering panel, pricing
found: "2026-09-11T07:33:26Z"
---

# B1423 — The build charge is labelled as the print, so the panel names 40 credits for something that costs 165

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Seen on a phone, `/algarve-2026` ordering panel, 2026-09-11:

> **40 Credits — etwa CHF 8.00, nur der Druck.** Der Versand kommt dazu,
> sobald ein Empfänger gewählt ist.

"Nur der Druck" — print only — is exactly what that number is not. 40 credits
is `PHOTOBOOK_BASE_CREDITS`, the **build** charge: a flat fee for laying the
book out, which `build.ts:84` documents as deliberately independent of size and
cover "since the print step charges the paper from a live quote", and which
`test/photobook-pricing.test.ts:34` asserts is *below* landed cost on purpose.

The print is the other number. For the book on screen — 46 pages, 200 × 200
softcover, to Switzerland — the measured basis in `lib/credits/pricing.ts`
gives print `6.04 + 0.161 × 46` = CHF 13.45 plus CHF 8.52 postage, so
`photobookPrintCredits` charges **165 credits**. The panel names 40 as the
print and the real print is roughly four times that. The button beside it
reads "Buch bestellen — 40 Credits" where a chosen recipient makes the total
205.

**This is a regression from B1406, merged 2026-09-10.** Before it, the line
read `photobook.price` — "inkl. Druck und Versand" — which overclaimed by
promising postage the fallback number did not include. B1406 correctly stopped
that claim and introduced `photobook.pricePrintOnly`, but named the wrong half:
it calls the build fee the print. Wrong in a new direction rather than fixed.

The button is disabled in this state (`buyable` is false with no recipient), so
nobody can press it at 40 — the harm is a figure five times under the real one
sitting where a person is deciding whether to go on.

## Work

- `photobook.pricePrintOnly` (en/de/hu) names what 40 credits actually buys.
  It is the build — the laid-out PDF — not the print. Say that, or say nothing
  and let the total appear with the recipient.
- Check the same question one screen earlier: B1405 removed a price from the
  first-book flow for the neighbouring reason, and this is the same mistake at
  the next step.
- Decide whether a figure belongs here at all before a recipient exists. The
  honest options are the build charge named correctly, or no number until the
  quote resolves. Do not invent a postage figure.
- While there: the button's own label reads 40 in this state. If the panel
  keeps a number, the button should agree with whatever it says.

**Not in this ticket.** No change to `PHOTOBOOK_BASE_CREDITS`, to
`PHOTOBOOK_PRINT_MARGIN`, or to how the quote is computed. The numbers are
right; only the words on top of them are wrong.

## Acceptance

- With photographs and no postable contact, no line on the panel calls 40
  credits the print.
- Whatever figure the panel shows, the button says the same one.
- Real German and real Hungarian. (hu currently ships the English string for
  this key — see B1406's own note.)
- `npm run verify` clean.
