---
id: B185
title: A locale cookie the journal does not list translates the tab title but not the page under it
type: ISSUE
priority: low
complexity: low
area: i18n, metadata
found: "2026-09-03"
started: "2026-09-04T06:22:42Z"
merged: "2026-09-04T07:11:28Z"
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

## What changed

**Same bug as B140, which carries the fix** — that ticket was found on the map
page's `<title>`, this one on `/xydhd-qa3/me`'s, and both are `requestLocale()`
narrowing the `fs.locale` cookie against `installedLocales()` while the layout
narrows it against `user.locales`. One change in `lib/locales.ts` closes both;
nothing separate was built for this id.

This file asked for the stronger of the two remedies and got it: **one
locale-resolution path serves metadata and layout alike.** `readerLocale(chosen,
offered, fallback)` is the rule, `app/[user]/layout.tsx` calls it with the
journal's own `locales` and `defaultLocale`, and `readerLocaleForPath` — which
is all `requestLocale()` now does — calls it with the same two values looked up
from the path. There is no second copy of the expression left to drift.

The Why's last paragraph asked whether the split is systematic rather than two
instances. It is worth recording what the sweep found:

- **`generateMetadata` deciding independently of the page** is real and
  recurring — B118 (tense), B139 (language), and this (locale source) are three
  instances in the same month.
- **The locale half is now structural rather than remembered**: a
  `generateMetadata` that calls `requestLocale()` cannot pick a language the
  journal does not offer, because the narrowing happens inside it.
- **The rest is not**. Every other `generateMetadata` still restates whatever
  conditional the page renders — the map's tense is the standing example, and
  B214 is a fresh one on the costs page's description. That is a shape, not a
  bug, and no single function fixes it.

## Evidence

`test/reader-locale.test.tsx`, and the acceptance lines directly:

- *A cookie naming a language the journal does not list leaves both the title
  and the body in the journal's language* — `readerLocaleForPath("/alex/gallery",
  "de") === "en"`, and the gallery's `<title>` is "Gallery"; before the fix it
  was "Galerie".
- *A cookie naming a language the journal does list still switches both* —
  `/mila/gallery` with `fs.locale=de` gives "Galerie" in the tab and `de` in the
  body.
- *One locale-resolution path* — both callers are `readerLocale`; the test
  asserts the two entry points agree for the same journal rather than trusting
  that they were written the same way.
