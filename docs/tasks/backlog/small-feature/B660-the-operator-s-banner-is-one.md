---
id: B660
title: The operator's banner is one language on a multilingual instance
type: FEATURE
priority: medium
complexity: low
area: site config, landing page
found: "2026-09-07T06:35:20Z"
---

# B660 — The operator's banner is one language on a multilingual instance

## Why

`site.banner` puts the operator's notice across the top of the landing page —
on this instance, *"Beta – Testphase: Einige Funktionen sind noch
unvollständig, und Datenverlust ist nicht auszuschliessen."* The page under it
renders in the reader's language (`requestLocale()`, B225); the banner did not,
because `parseBanner` in `lib/config.ts` took one string and `lib/site.ts:32`
handed it straight to `app/page.tsx`. An English or Hungarian reader got a
German warning about data loss over an English page — which is the shape of
B225 one element higher, and this one is the element that says the data might
go away.

It is deliberately not a locale-file string: an instance cannot add a key to
`site/locales/` without editing the checkout, so the words have to stay in the
operator's own config.

## Work

- `site.banner` gains an optional `translations: { [locale]: string }` beside
  `text`. `text` stays required and stays the fallback — a reader whose
  language the operator did not write gets the notice anyway.
- `bannerFor(locale)` in `lib/site.ts` does the pick: exact tag, then the base
  language (`de-CH` → `de`), then `text`. `serverSite().banner` is gone; the
  landing page is now async and calls it with the locale it already resolves.
- `site/config.json` carries de, en and hu for the beta notice.
- Not doing: translating it for the operator, or any locale-file involvement.
  Empty translations are dropped rather than served as a blank banner.

## Acceptance

- `npx vitest run test/site-banner.test.ts test/config.test.ts` — the pick,
  the base-language fallback, the fallback to `text`, and the parse rules.
- `/` with `Accept-Language: en` shows the English sentence; with `de`, the
  German one; with `hr`, the German one (the `text` fallback).
- The deployed instance overrides `site/config.json` with `FERNSCOUT_CONFIG`
  ($DATA_DIR/config.json) — the same `translations` block has to be added
  there, or the VPS keeps showing German to everyone.
