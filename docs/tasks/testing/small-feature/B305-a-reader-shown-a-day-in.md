---
id: B305
title: A reader shown a day in a language they did not ask for is told nothing about it
type: FEATURE
priority: low
complexity: low
area: i18n, viewer
found: "2026-09-04T15:20:03Z"
started: "2026-09-05T15:09:33Z"
merged: "2026-09-05T15:20:47Z"
---

# B305 — A reader shown a day in a language they did not ask for is told nothing about it

## Why

B294's ticket asked for this and B294 deliberately did not build it.

`localized()` in `components/LocaleProvider.tsx` falls back to the language a
day was written in when it carries no translation for the one being read. That
is the right behaviour — a day written before B294 required every language
still reads, for everybody, rather than showing an empty page. What is missing
is the sentence: a reader who switched to English and got German prose sees no
explanation, which is the complaint that opened B294 in the first place.

Two reasons it was held back rather than guessed at, both worth keeping in
view when picking this up:

- **It is now a legacy-only path.** Since B294, a day missing a declared
  language is refused at the door. Only a day written before that, or one whose
  journal later added a language, can fall back at all. So the notice is for
  the archive, not for new writing — which changes how prominent it should be.
- **It is a wording decision in three languages**, not a mechanism. The
  mechanism is three lines; getting *"this day has not been written in English
  — you are reading the German"* to sound like an explanation rather than an
  apology, in German and Hungarian too, is the work. B289 is the standing
  warning about interpolating a language name into a Hungarian sentence.

## Work

- `localized()` already knows it fell back — it is the branch where
  `entry.translations?.[locale]` came back undefined. Return that fact
  alongside the title and content rather than making callers re-derive it.
- Show it where a day's prose is read, not on every card in a list: a feed of
  twenty cards each carrying a language notice is noise, and the reader who
  needs to know is the one reading the day.
- Three locales, and mind B289 on the Hungarian.
- Consider — do not assume — whether the trip and journal pages want the same
  treatment when a *trip's* title falls back. That has been true since
  translations existed for trips and nobody has complained, which is evidence
  it matters less there.

## Acceptance

A reader on a language a day does not carry is told, once, on the day itself,
in their own language; a reader on the language it was written in sees nothing
new.

## Resolution

The owner made the three calls the ticket held back on:

1. **Wording — plain fact, no apology, no explanation of why or when.**
   `Written in German — no English version of this day.` (and the German and
   Hungarian equivalents). Six strings, one per (reader locale, written
   locale) pair, added as `fallback.writtenIn.<writtenLocale>` in each of
   `content/locales/{en,de,hu}.json` — **not** built by interpolating a
   language name into a template. B289 is why: Hungarian marks case with a
   suffix whose form depends on the vowels of the word it attaches to
   (*Németül*, *Angolul*), so no suffix is correct for every language name.
   The set of languages is closed (`MAINTAINED_LOCALES`), so enumerating the
   pairs as dictionary keys is the whole fix — no suffix table, no grammar
   engine. The same-locale key (e.g. `fallback.writtenIn.en` in `en.json`)
   is not written at all: `locale === writtenLocale` short-circuits before
   the key is ever looked up, and each dictionary only needs the two keys
   for the *other* two locales.
2. **Prominence — a quiet line, not a banner.** `<p className="mb-4 text-xs
   italic text-navy-500">`, under the day's `<h2>` and above `EntryContent`,
   in `components/StoryPager.tsx`'s `UpdateBlock`. Deliberately not
   `DraftNotice`/`TestNotice`'s bordered coral treatment — those guard against
   an owner mistaking an unpublished or invented day for a real, live one;
   this is a legacy day reading correctly in the only language it has, which
   is expected and unremarkable now that B294 refuses a new day missing a
   declared language at the door. Loud would overstate what's wrong.
3. **Scope — days only, not trips or the journal.** Considered and declined.
   A trip's title has fallen back since translations existed for trips
   (`localizedTripTitle` in `lib/i18n.ts`) and nobody has complained — which
   is itself the evidence it matters less there. The asymmetry is real: a
   trip's fallback is one word in a header a reader skims past; a day's
   fallback is the reader settling in to read prose that turns out to be in
   a language they didn't ask for, which is the complaint that opened B294.
   Do not add this notice to trip or journal pages without a fresh ticket
   and a fresh reason — this decision is not "nobody got to it yet."

### What changed

- `components/LocaleProvider.tsx` — `localized()` now also returns
  `fallbackNotice?: TranslationKey`, set exactly when
  `entry.translations?.[locale]` came back `undefined` (and `locale !==
  writtenLocale`). The key is `` `fallback.writtenIn.${writtenLocale}` ``,
  cast to `TranslationKey` — callers don't re-derive the fallback fact, they
  just render the key if present.
- `components/StoryPager.tsx` — `UpdateBlock` destructures `fallbackNotice`
  and renders it as the quiet line described above. `SlideShow.tsx`'s use of
  `localized()` (the narrated-cut headline overlay) is untouched — it isn't
  a place a day's prose is read, it's a one-line narration extract, and a
  notice there would be noise on top of noise.
- Dictionary keys added, `content/locales/{en,de,hu}.json` (2 each, appended
  as a separate block at the end of each file — not reformatted, not
  reordered, to keep the diff clean against B432's parallel edits to
  `de.json`):
  - `en.json`: `fallback.writtenIn.de`, `fallback.writtenIn.hu`
  - `de.json`: `fallback.writtenIn.en`, `fallback.writtenIn.hu`
  - `hu.json`: `fallback.writtenIn.de`, `fallback.writtenIn.en`
- `lib/i18n.ts` — `TranslationKey` regenerated via `npm run i18n:keys`
  (adds `fallback.writtenIn.de` and `fallback.writtenIn.hu`; `.en` isn't a
  member because it isn't a key in the shipped English file, which is what
  the generator reads — the cast in `LocaleProvider` covers it).

### Evidence

`test/fallback-notice.test.tsx` (new): renders `LocaleProvider` + a probe
that mirrors `UpdateBlock`'s own condition, for all 3×3 (reader locale,
written locale) pairs.

- Same-locale pairs (en/en, de/de, hu/hu): no `data-fallback-notice` in the
  markup — "a reader on the language it was written in sees nothing new."
- The six cross-locale pairs: exactly one `data-fallback-notice` node,
  containing the correct reader-language sentence — "a reader on a language
  a day does not carry sees the notice once, on the day itself, in their own
  language."

`test/written-locale.test.tsx` (existing, unchanged) still passes — the
`localized()` fallback behaviour it covers is unaffected by the added field.

### Verify

`npm run verify` — build, tsc, eslint, vitest — all green (230 test files,
3128 passed, 3 skipped for lack of a local Postgres, which is unrelated).
No new lint warnings introduced by this change.
