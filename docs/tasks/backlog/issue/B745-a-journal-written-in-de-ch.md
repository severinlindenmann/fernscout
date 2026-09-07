---
id: B745
title: A journal written in de-CH gets English chrome
type: ISSUE
priority: medium
complexity: low
area: i18n, locales
found: "2026-09-07T12:46:57Z"
---

# B745 — A journal written in de-CH gets English chrome

## Why

`lib/locales.ts:75` — `readDictionary` looks for `site/locales/<tag>.json` and
falls back to **English** when there is none. So a journal with
`defaultLocale: "de-CH"` gets English chrome rather than German.

That was harmless while nobody wrote `de-CH`. B686 made it a meaningful thing
to write: it is the tag that selects Swiss German transcription, so a Swiss
owner now has a good reason to set it — and gets an English interface as the
reward.

The fix is a base-language fallback: `de-CH` → `de` → English, rather than
`de-CH` → English.

## Acceptance

A journal with `defaultLocale: "de-CH"` reads German, and a test covers the
narrowing.
