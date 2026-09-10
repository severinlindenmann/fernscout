---
id: B1406
title: "A book with no recipient is refused with the message for a book with no photographs"
type: ISSUE
priority: high
complexity: low
area: photobook, the ordering panel
found: "2026-09-10T22:00:00Z"
---

# B1406 — A book with no recipient is refused with the message for a book with no photographs

## Why

One panel, saying three things that cannot all be true:

> Diese **47 Fotos** haben für diese Grösse zu wenig Pixel …
> 46 Seiten · Quadratisch, 20 × 20 cm
> **Es gibt noch niemanden, an den dieses Buch geschickt werden kann.**
> 40 Credits — etwa CHF 8.00, inkl. Druck und Versand
> **Ein Buch braucht mindestens ein Foto.** Nimm eins zurück in die Auswahl,
> bevor du bezahlst.

47 photographs, 46 pages, and the page says the book has none. The person is
told to fix the one thing that is not wrong, and the actual blocker — no
postable contact — is stated two lines above as a neutral fact rather than as
the reason the button is dead.

**Three causes, one boolean.** `app/[user]/photobook/preview/route.ts:140`:

```js
buyable: book.photoCount > 0 && quote !== null && !("error" in quote),
```

`BookLevelView.tsx:201` reads `preview?.buyable === false` and `:486-489`
renders exactly one sentence for it — `photobook.noPhotos`. So "no
photographs", "no quote at all" and "the printer answered with an error" are
indistinguishable on screen, and the sentence chosen is the one for the first.
The route's own comment at `:134-139` says *"Two things now, not one — B1157"*,
which is the code knowing what the page does not.

**The right answers already exist and are already in hand.** The route sends
`quoteError` (`:127`); nothing in the photobook components reads it — `grep
quoteError` over `app/[user]/(trip)/photobook/` returns no use.
`photobook.print.noRecipients` and `photobook.printerUnavailable` are written
and mapped in `OUTCOME_MESSAGE` (`PhotobookPageContent.tsx:44-46`) for the
*order* outcome, after a press. Before the press the page has both the code and
the wording and shows neither.

**One more inaccuracy from the same root.** With no quote, `credits` falls back
to `priceOf(book)` (`:125`) — the 40 credits on screen — while
`photobook.price` says *"inkl. Druck und Versand"*. Postage is exactly what is
missing from that number. The fallback is deliberate and the route's comment
explains it; the string sitting on top of it is what is wrong.

(The credits warning is correct — 8.96 against 40 — and is not part of this.)

## Work

- Say which of the three it is. Carry the reason to the panel — `quoteError`
  is already there, and `photoCount` distinguishes the first case — and render
  `photobook.noPhotos`, `photobook.print.noRecipients` or
  `photobook.printerUnavailable` accordingly. Reuse the existing keys; do not
  write a fourth.
- Prefer following `OUTCOME_MESSAGE`'s shape (`PhotobookPageContent.tsx:35`):
  a total `Record` over the reason type, so a new refusal added to the route
  fails `tsc` here instead of rendering the wrong sentence. That is exactly
  what this ticket is.
- When there is no quote, the price line must stop claiming it includes
  postage. Either say the total comes with the recipient, or show the print
  cost as what it is. Do not invent a postage figure.
- Keep `buyable` as the one thing that disables the button — the guard is
  right, only the explanation is wrong. Nothing about what may be bought
  changes here.

**Not in this ticket.** No change to the low-resolution warning, to the quote,
or to the credits check. B1399 is the neighbouring reason there is no postable
contact in the first place; B1405 is the same panel's price shown too early in
the flow.

## Acceptance

- A trip with photographs and no postable contact says there is nobody to send
  it to, and does not mention photographs. Seen in a browser
  (`test-in-a-browser`).
- A book genuinely without photographs still says so.
- A printer that cannot be reached says that.
- With no quote, no line on the panel claims a total that includes postage.
- `npm run verify` clean.
