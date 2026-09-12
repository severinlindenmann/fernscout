---
id: B1589
title: Photobook language leaves trip text and fallback labels untranslated
type: ISSUE
priority: medium
complexity: medium
area: photobook, i18n
found: "2026-09-12T13:52:51Z"
started: "2026-09-12T15:27:43Z"
merged: "2026-09-12T19:34:36Z"
---

# B1589 — Photobook language leaves trip text and fallback labels untranslated

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

Live testing after the first merge found the scope was incomplete. On
`severin/ungarn-2026`, a Hungarian book renders Hungarian day translations and
book labels but leaves the trip title, introduction and back-cover blurb in
German, and renders a chapter with no country as English “Elsewhere”. The live
trip has no `translations` block, and the current `TripTranslations` contract
can store only `title` and `tagline`; there is no supported place to save a
translated introduction. `buildBookSource` also copies `trip.title`,
`trip.tagline` and `trip.intro` without resolving the chosen locale, while
`chaptersOf` hard-codes “Elsewhere” before the selected `BookStrings` reaches
the chapter page.

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
- Extend `TripTranslations` and the trip create/correction API contract so a
  saved translation may include the trip introduction as well as title and
  tagline, and return it on readback.
- Resolve the trip title, tagline and introduction independently against the
  book locale in `buildBookSource`, falling back field by field to the written
  trip text.
- Make the no-country chapter label part of `BookStrings` and supply English,
  German and Hungarian text instead of hard-coding English in `chaptersOf`.

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
- A Hungarian book uses saved Hungarian trip title and introduction text on
  the title, introduction and back-cover pages, while missing translated fields
  fall back independently to the written trip.
- A chapter whose day has no country uses a Hungarian fallback label in a
  Hungarian book.
- The trip translations API accepts, persists and reads back `intro` and its
  OpenAPI/agent documentation names the field.

## Implementation

- Added optional `intro` to `TripTranslations`, including parser, create and
  correction validation, readback, OpenAPI schemas and the agent guide.
- Photobook source resolution now selects saved trip title, tagline and intro
  per field; chapter fallback labels now come from the selected book strings.
- Added regression coverage for translated covers/intros, localized chapter
  fallback and the API round trip.

## Verification

- Focused photobook, trip API, contract and OpenAPI suites: 207 tests passed.
- TypeScript passed; targeted ESLint passed with one pre-existing warning in
  `lib/photobook/plan.ts`.
- The local production build could not fetch Google Fonts because this
  environment has no DNS access to `fonts.googleapis.com`; the prior deployed
  build and the code-only typecheck remain intact.
- `npm run verify` passes; a test in `test/photobook-*.test.ts` (or a new
  file) covers the locale-resolution behavior in `buildBookSource`.

## Verification

- Exact `npm run verify` after merging current main: build, TypeScript,
  ESLint, 7,505 tests (one file / 41 tests skipped), and knip all passed.
- Deployed commit `9d525550a322` is healthy at `fernscout.ch/api/health`.
  The live owner preview for `severin/ungarn-2026`, with Magyar selected,
  renders the saved Hungarian cover title, back-cover and introduction text,
  and `Máshol` for the no-country chapter. The desktop and 390px browser
  captures returned 200 with no console errors or failed requests.
- `test/photobook-source.test.ts`: 21 tests pass, including source fallback
  and the `planFor` locale path.
- After syncing current `main`, `npx next build --webpack` compiles, passes
  generated route types, generates all 91 static pages, and completes.
  `npm run verify -- --quick` then passes TypeScript, ESLint, 7,230 tests, and
  knip. One test file and 41 tests are skipped; ESLint reports the existing 71
  warnings and no errors. The suite reports that restic and Postgres are not
  available in this environment.
- Browser evidence on the existing `alps-2024` demo trip is in
  `/tmp/b1589-browser/`: the Hungarian preview contains “Át a Susten-hágón”
  and its Hungarian prose, while the untranslated “We stayed for dinner”
  update remains in English. Both widths returned 200 with no console errors
  or failed requests.
- B1590 removed the invalid App Router helper exports that had blocked the
  generated route typecheck. The default Turbopack build still cannot bind its
  internal worker port in this sandbox, so the successful webpack production
  build plus the official quick gate cover the same build, type, lint, test,
  and unused-code stages here.
