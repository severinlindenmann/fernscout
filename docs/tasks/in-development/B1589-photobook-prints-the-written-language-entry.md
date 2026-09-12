---
id: B1589
title: Photobook prints the written-language entry text, ignoring the book's own language and the entry's translations
type: ISSUE
priority: medium
complexity: low
area: photobook, i18n
found: "2026-09-12T13:52:51Z"
started: "2026-09-12T14:17:03Z"
---

# B1589 — Photobook prints the written-language entry text, ignoring the book's own language and the entry's translations

## Why

An entry may carry `translations` per locale (`EntryTranslations`,
`lib/types.ts:193/238`), and a journal with multiple `locales` writes real
translated text into it — not just the chrome, the day's own prose. Ordering
a photobook in one of those other languages (e.g. Hungarian, with a journal
written primarily in German) should print the Hungarian version of each
entry that has one.

It does not. `lib/photobook/source.ts:436-437` builds a day's paragraphs
straight from `entry.content` / `entry.title` — the written-language text —
with no regard for the book's own `options.locale`. `buildBookSource()`
(`lib/photobook/source.ts:340`) is never even passed a locale to resolve
against. The result, seen in a real order: the book's own labels
("Autóval", month names, headings) come out in Hungarian via
`lib/photobook/strings.ts`, but every day's actual written text stays in the
journal's primary language (German) even where a Hungarian translation
already exists on the entry.

This is not the documented "day's prose is printed as written" rule in
`lib/photobook/strings.ts`'s own comment — that rule is about *not
machine-translating on the fly*. It says nothing about ignoring a
translation the author (or an agent on their behalf) already wrote and saved
to the entry. Two other call sites resolve this correctly already and can be
used as the reference: `app/api/v1/[user]/postcards/texts/route.ts:75` and
`lib/helper/tools/areas/printed.ts:150`, both doing
`locale === written ? entry.content : entry.translations?.[locale]?.content`.

Revalidated 2026-09-12: **valid**. `lib/photobook/source.ts` still builds the
day title and paragraphs directly from `day.lead.title`, `entry.title` and
`entry.content`; both callers in `lib/photobook/build.ts` still omit the book
locale when they call `buildBookSource`.

## Work

- Thread the book's chosen locale (`options.locale`, already on `BookOptions`
  in `lib/photobook/options.ts:38`) from `planFor()`
  (`lib/photobook/build.ts:35`) into `buildBookSource()`
  (`lib/photobook/source.ts:340`).
- In `buildBookSource`, resolve each entry's title and content against that
  locale the same way the postcard/printed-tools call sites do: the
  journal's written locale keeps `entry.content`/`entry.title`; any other
  locale falls back to `entry.translations?.[locale]?.content` /
  `?.title`, and falls back further to the written text when no translation
  exists for that entry (an entry with no translation must still print,
  not disappear).
- Not doing: any new translation step. If an entry has no `translations`
  entry for the chosen locale, print what's there (written language) rather
  than inventing a translation — same rule as everywhere else in this repo.

Implemented by making the selected locale part of `SourceOptions` and passing
it from both the preview planner and the order builder. Entry title and content
fall back independently, so a partial saved translation cannot erase either
field; direct source callers that omit a locale retain the written-language
behaviour.

## Acceptance

- A trip with an entry carrying `translations.hu.content` (and one entry
  deliberately left untranslated), ordered as a Hungarian-locale photobook,
  prints the Hungarian text for the translated entry and the written-language
  text for the untranslated one — not the written-language text for both.
- `npm run verify` passes; a test in `test/photobook-*.test.ts` (or a new
  file) covers the locale-resolution behavior in `buildBookSource`.

## Verification

- `test/photobook-source.test.ts`: 21 tests pass, including source fallback
  and the `planFor` locale path.
- Full suite: 554 files pass, one is skipped; 7,216 tests pass and 41 are
  skipped. ESLint reports no errors, and `npm run unused` passes.
- Browser evidence on the existing `alps-2024` demo trip is in
  `/tmp/b1589-browser/`: the Hungarian preview contains “Át a Susten-hágón”
  and its Hungarian prose, while the untranslated “We stayed for dinner”
  update remains in English. Both widths returned 200 with no console errors
  or failed requests.
- The exact `npm run verify` gate is still blocked: Turbopack cannot bind its
  internal worker port in this sandbox, and the webpack fallback reaches two
  pre-existing invalid App Router helper exports. Captured separately as
  B1590; B1589 remains in development until the repository gate can pass.
