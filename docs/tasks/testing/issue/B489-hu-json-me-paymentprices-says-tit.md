---
id: B489
title: hu.json me.paymentPrices says útitól, which is not a Hungarian word
type: ISSUE
priority: low
complexity: low
area: i18n
found: "2026-09-05T15:36:30Z"
merged: "2026-09-05T15:47:39Z"
---

# B489 — hu.json me.paymentPrices says útitól, which is not a Hungarian word

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`content/locales/hu.json`, `me.paymentPrices`: *"1 kredit e-mailenként, 1
kredit WhatsApp-üzenetenként — mindig ugyanennyi, **útitól** függetlenül."*
The English is *"flat, whatever the trip"*. `útitól` is not a word: `úti` is
the adjective ("travel-", as in `útitárs`), and an adjective does not take the
ablative here. The ablative of `út` is **`úttól`** — long vowel, doubled `t`.

Found while doing B485 (the `utazás` → `út` sweep of the same file). It was
left alone there because B485's scope was the `utazás` strings and absorbing a
second defect into a ticket quietly is the thing AGENTS.md says not to do.

## Work

- `me.paymentPrices`: `útitól` → `úttól`. One word, one string.
- Nothing else. No test — see B485 on why one word of Hungarian is not worth
  pinning in the suite.

## Acceptance

- `grep -c 'útitól' content/locales/hu.json` is 0.
- `npm run verify` passes.
