---
id: B1549
title: The order receipt says the photobook is on its way when it has only reached the printer's queue
type: ISSUE
priority: medium
complexity: low
area: photobook
found: "2026-09-12T00:45:00Z"
started: "2026-09-11T22:46:08Z"
session: 57d87f37-ef96-4bb1-8533-8025978abf0c
claimed: "2026-09-11T22:46:08Z"
---

# B1549 — The order receipt says the photobook is on its way when it has only reached the printer's queue

## Why

`photobook.receipt.title` is *"Danke — dein Fotobuch ist unterwegs"* / *"Thank
you — your photobook is on the way"*, and the owner read one on a real order
and said plainly that it is not on the way: it has not been printed yet.

They are right, and the code says so. `app/[user]/photobook/order/route.ts:322`
sends this mail only after `submitBuiltBook` returns `ok` — which means Gelato
**accepted the order**, not that anything has been printed, boxed or posted. A
refusal gets its own mail (B1330), so the receipt's one meaning is "the printer
has it".

This is the same class of fault AGENTS.md is built around: a sentence a person
has no way to check, that is not true. "On the way" is what somebody starts
counting delivery days from.

## Work

Reword the three locales — English, German, Hungarian — to what the moment
actually is: the book is going to be printed shortly. The owner's own words
for it were *"das Fotobuch wird bald gedruckt"*.

`test/photobook-receipt.test.ts:146` asserts the current phrase and has to
follow. It is there for a reason worth keeping — the line above it forbids
"your photobook is ready", because that was an even stronger false claim
(B1330) — so replace the assertion rather than deleting it.

Not doing: `photobook.receipt.preheader` ("ready to download"), which is true;
the `notPrinted` paragraph, which only appears where nothing prints at all; or
the shipping mail, if there ever is one.

## Acceptance

- The receipt's heading claims the book will be printed, not that it has been
  sent, in all three locales.
- `test/photobook-receipt.test.ts` asserts the new phrase and still forbids
  "ready".
- Read on a real `.eml` from the instance, not only in the JSON.

## What was found and done

**Valid, and narrower than it looks.** The receipt is sent from
`app/[user]/photobook/order/route.ts:363`, and only on the branch where
`submitBuiltBook` returned `ok` — a refusal takes `sendPhotobookRefused`
instead (B1330). So this mail has exactly one meaning, and it is "the printer
has accepted the order". Nothing has been printed and nothing has moved.

Three strings, one test assertion. The German is the owner's own phrasing.

| | |
| --- | --- |
| en | Thank you — your photobook goes to print shortly |
| de | Danke — dein Fotobuch wird bald gedruckt |
| hu | Köszönjük — a fotókönyved hamarosan nyomdába kerül |

The test assertion is now a pair — the new phrase must be present *and* "on
the way" must be absent — beside the "your photobook is ready" line that has
been there since B1330. Three false claims about the same moment have now been
made in this one heading, so the negatives are the part worth keeping.

Left alone deliberately: `preheader` ("ready to download") is true, and the
`notPrinted` paragraph is unreachable on an instance that prints, because a
book that cannot be submitted never gets this mail at all. That paragraph
looks like dead code from here and is not this ticket's to remove — worth a
look by whoever next touches `receipt.ts`.

## Evidence

- `npm run verify` — all 5 steps green.
- `test/photobook-receipt.test.ts` asserts the new phrase and forbids both
  older claims.
- A **real rendered `.eml`**, German, through the actual sender and mail
  transport rather than the dictionary: heading *"Danke — dein Fotobuch wird
  bald gedruckt"* in the plain-text part and in the `<h1>` of the HTML part.
  Captured at `scratchpad/b1549-receipt-de.eml.txt`.
