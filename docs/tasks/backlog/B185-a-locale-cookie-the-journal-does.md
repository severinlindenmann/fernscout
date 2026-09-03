---
id: B185
title: A locale cookie the journal does not list translates the tab title but not the page under it
type: ISSUE
priority: low
complexity: low
area: i18n, metadata
found: "2026-09-03"
---

# B185 — Metadata and body disagree about which locale applies

## Why

Found while verifying B75, which passes. This is incidental to it and
pre-existing.

Two different questions decide the language of one page:

- **The body** takes the journal's own languages — the layout checks
  `user.locales`, so a journal that lists only `en` renders English whatever
  the reader asks for. That is right: a journal is written in the languages its
  owner writes in.
- **The metadata** takes `requestLocale`, which only checks `installedLocales` —
  the languages the *instance* maintains. It does not ask what the journal
  lists.

So a `fs.locale=de` cookie on `xydhd-qa3`, a journal that lists only `en`,
produces a German `<title>` — "Dein Zugang" — over an entirely English page.
Observed live on `/xydhd-qa3/me`.

Nothing is broken and nothing leaks. The cost is small and entirely
presentational, but it lands in the places a page gets carried around: the
browser tab, a bookmark, a link preview, a shared screenshot. Somebody sees a
German title on an English page and reasonably concludes the site is half
translated.

This is the second instance of the same shape found today — **B118** is a
`<title>` and an `<h1>` disagreeing about tense on the map page. Different
cause (that one is a conditional the metadata never learned; this one is two
different locale sources), same symptom: `generateMetadata` deciding
independently of what the page will actually render. Worth looking at whether
that split is systematic rather than fixing two instances of it.

## Work

- Resolve the metadata locale the way the layout does: the journal's own
  `locales`, falling back to its `defaultLocale`, and only then to the
  instance's installed set. One function both callers use, so they cannot
  diverge again.
- Check the other routes with `generateMetadata` for the same split while in
  there.

Not doing: changing which languages a journal renders in. `user.locales` is the
right authority and the body already honours it.

## Acceptance

- A `fs.locale` cookie naming a language the journal does not list leaves both
  the `<title>` and the body in the journal's language.
- A cookie naming a language the journal *does* list still switches both.
- One locale-resolution path serves metadata and layout alike.
