---
id: B1364
title: First-book price reads money-then-credits, unlike every other price line
type: CHORE
priority: low
complexity: low
area: photobook, i18n
found: "2026-09-10T18:25:49Z"
---

# B1364 — First-book price reads money-then-credits, unlike every other price line

## Why

The first-time photobook flow states the price money-first, credits in
parentheses: `site/locales/de.json:859` — `"Etwa {money} ({credits}
Credits)."`, rendered at
`app/[user]/(trip)/photobook/FirstBookFlow.tsx:531`. Every other price line in
the app, including the regular (non-first-book) photobook price shown later in
the same flow (`photobook.price`, `site/locales/de.json:884` —
`"{credits} Credits — etwa {money}, inkl. Druck und Versand"`), states it
credits-first with the money as the approximate figure. A reader hits the two
phrasings back to back in one order flow.

## Work

Reword `photobook.first.price` in `en.json`, `de.json` and `hu.json` to match
the shape of `photobook.price`: credits first, then "— about/etwa {money}",
plus what the reader here doesn't yet know from `photobook.price` — that
printing and postage are included. E.g. English: `"{credits} credits — about
{money}, printed and posted."` German: `"{credits} Credits — etwa {money},
inkl. Druck und Versand."` (i.e. reuse or align with `photobook.price`'s
existing wording rather than reinvent it) — write the real Hungarian rather
than leaving it identical to English, which it currently is even for the
unrelated `photobook.first.price` key today.

Not touching: `photobook.price` itself, already correctly worded; any other
price string.

## Acceptance

`site/locales/en.json`, `de.json` and `hu.json`'s `photobook.first.price`
values lead with `{credits}` and end with the approximate money figure,
mentioning print + postage. `npm run verify` passes (locale key parity,
`i18n:keys` union unaffected since no key added/removed).
