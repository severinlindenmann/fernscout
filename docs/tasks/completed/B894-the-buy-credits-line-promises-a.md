---
id: B894
title: The buy-credits line promises a mail with a price, which is not what the button does
type: ISSUE
priority: medium
complexity: low
area: account, credits, copy
found: "2026-09-07T20:35:00Z"
merged: "2026-09-07T18:50:41Z"
completed: "2026-09-09T16:45:59Z"
---

# B894 — The buy-credits line promises a mail with a price, which is not what the button does

## Why

The owner, on `/example/account`: *"this text is wrong, remove — 'Schickt dir
den Preis per Mail — noch wird nichts abgebucht.'"*

`me.paymentBuyBody` sits under the buy button on the account page:

| | |
| --- | --- |
| de | Schickt dir den Preis per Mail — noch wird nichts abgebucht. |
| en | Mails you the price — nothing is charged yet. |
| hu | E-mailben elküldi az árat — egyelőre semmi nem kerül levonásra. |

The button it explains opens a menu of amounts
(`AccountPageContent.tsx:436`). It does not mail anything. The sentence
describes a flow that either changed or never existed, and a line under a
money button that describes the wrong behaviour is worse than no line: the
half a reader is most likely to trust is "nothing is charged yet".

## Work

Remove the line and the key from all three locales. Do not replace it with a
corrected sentence: the button says what it does, the menu that opens states
the amounts, and the confirmation is where a claim about charging belongs —
this line was explaining a step that is not there.

Check nothing else renders the key before deleting it.

## Acceptance

- `/[user]/account` shows no such line under the buy button.
- `me.paymentBuyBody` is gone from `en`, `de` and `hu`, and from the
  `TranslationKey` union.
- Nothing else referenced it.

## Also in this branch: the chip word (B886 follow-up)

The owner, after B886 shipped "Reise wechseln": *"I say call it 'Reisen' but
not 'Reise wechseln', this is too long again for mobile."*

Asked twice now, so it is settled: the chip carries `trips.chip` — "Reisen" /
"Trips" / "Utak". My objection stands in B886 and is recorded rather than
re-argued: it repeats `nav.trips`, a destination in the same panel. The
`aria-label` stays `trips.switch`, so a screen reader still hears what the
control does rather than a word shared with something else.

The owner's instinct was right about more than length. Measured at 390px:

| chip | width | row |
| --- | --- | --- |
| 🧳 Trips ⌄ | 96px | 1 |
| CHF | 47px | 1 |
| EN | 56px | 1 |
| Docs | 81px | **1** |

All four fit one row — 280px against 332 — which "Reise wechseln" (137px)
could not do. The wrap I had accepted as inherent since B868 is gone.
