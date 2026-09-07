---
id: B745
title: A journal written in de-CH gets English chrome
type: ISSUE
priority: medium
complexity: low
area: i18n, locales
found: "2026-09-07T12:46:57Z"
started: "2026-09-07T12:55:01Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T12:55:01Z"
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

## Work done

`lib/locales.ts` — `localeFiles(code)` now splits a regional tag on `-` and,
when the base differs from the full tag, layers the base language's own
shipped/override files underneath this tag's (still-absent) ones before
returning. So `localeFiles("de-CH")` reads `de.json` first, then whatever a
`de-CH.json` might someday be — English is never reached as long as the base
language has chrome. `readDictionary`/`dictionarySignature` needed no change:
they already just read whatever file list they are handed.

Test: `test/locales.test.ts` — "a regional tag falls back to its base language
before English" asserts `dictionaryFor("de-CH")["nav.gallery"]` equals the
German string and differs from the English one. Fails before the fix (was
English), passes after. `npm run verify`'s full locale suite (29 tests in that
file) still passes, including the existing parity/fallback tests for `hr`
(no-chrome-at-all case, unaffected).
