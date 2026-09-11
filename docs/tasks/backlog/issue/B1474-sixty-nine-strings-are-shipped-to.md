---
id: B1474
title: Sixty-nine strings are shipped to Hungarian readers in English, including the whole of an order's status
type: ISSUE
priority: medium
complexity: low
area: locales
found: "2026-09-11T15:30:25Z"
---

# B1474 — Sixty-nine strings are shipped to Hungarian readers in English, including the whole of an order's status

## Why

Found by B1470, reading a real order on the live instance with
`Accept-Language: hu`. The photobook receipt came back as a Hungarian page with
an English spine through the middle of it:

> Fotókönyv · **Your order** · Algarve 2026 — 46 oldal, 1 kötetben · **Refused**
> · *The printer would not take this order. All 238 credits are back on your
> account…*

The title of the page, the state of the order and the sentence explaining that
the money came back are all English. A Hungarian reader is being told the most
consequential thing on the page in a language the site otherwise does not use
with them.

It is not this order's fault and not the order element's: `hu.json` carries the
English string as its value for those keys. **69 of 2352 keys are identical to
English in Hungarian**, against 29 in German — and the German ones are mostly
words that are the same in both languages ("Total"), where several of the
Hungarian ones plainly are not.

`test/locales.test.ts` cannot catch this: it asserts every locale *covers*
every English key, and a copied English value covers it.

## Work

Translate the 69. Derive the list rather than trusting a stored one:

```
node -e "const en=require('./site/locales/en.json'),hu=require('./site/locales/hu.json');
  console.log(Object.keys(en).filter(k=>hu[k]===en[k]&&en[k].length>3).join('\n'))"
```

Some are legitimately identical ("PDF", "Total") — leave those and say which,
so the next pass does not reopen them.

**This needs somebody who reads Hungarian.** AGENTS.md is explicit: nothing
checks that a translation means anything, so a plausible machine translation
ships and is read by somebody whose language it is. If that person is not
available, the honest outcome is a shorter list translated properly, not a
longer one guessed.

## Acceptance

The photobook receipt and the postcard order page read entirely in Hungarian
at `?lang=hu`, with no English left in the head, the status or the refund
sentence. `npm run verify` green.
