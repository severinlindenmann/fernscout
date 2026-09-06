---
id: B625
title: The installed PWA opens in English for a phone set to German
type: ISSUE
priority: high
complexity: low
area: PWA, i18n, language detection
found: "2026-09-06T17:51:42Z"
---

# B625 — The installed PWA opens in English for a phone set to German

## Why

Reported: a phone set to German, journal locales including German, installed
the site as a PWA and it opened in English — with Magyar selected in the
picker. Somebody who reads no English is then looking at an English page with
no obvious way out.

Two things to separate before fixing: what language the *first* request picks
(`Accept-Language` against the journal's `locales`), and what the installed app
remembers. A PWA launches from the manifest's `start_url`, which carries
whatever was current when the manifest was written or when the app was
installed — so an install can pin a language the person never chose. Magyar
appearing in the picker suggests the stored preference and the rendered page
disagree, which is its own fault.

## Work

- Trace where the locale actually comes from on a cold PWA launch: the
  manifest's `start_url`, any stored preference, the cookie, and
  `Accept-Language`. Write down which one won and why.
- The person's own device language, when the journal offers it, must beat a
  default. A stored preference must be one the person actually chose.
- Fix the picker showing a language other than the one rendered — whichever way
  round that disagreement is, it is a bug on its own.

## Acceptance

- Installing the PWA from a German phone, on a journal that offers German,
  opens in German — from a cold launch, with the app closed and reopened.
- The language the picker shows is the language on the page.
