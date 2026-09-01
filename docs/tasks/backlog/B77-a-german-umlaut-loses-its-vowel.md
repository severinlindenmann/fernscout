---
id: B77
title: A German umlaut loses its vowel in a slug, and two slugify functions disagree about the rest
type: ISSUE
priority: low
complexity: low
area: api, ingest, slugs
found: "2026-09-01"
---

# B77 — A German umlaut loses its vowel in a slug, and two slugify functions disagree about the rest

## Why

Found on 2026-09-01, on a German-language journal. A day titled *"Rückfahrt"*
was written through the API and got the slug `ruckfahrt`, and with it the
permalink `/…/day/ruckfahrt`. The German for that word is *Rueckfahrt* when it
has to be written without the umlaut; `ruckfahrt` is a different word (*Ruck*,
a jolt). A slug is the one part of an entry that is permanent — it is what gets
shared, and renaming it later breaks whatever was shared.

`slugify` in `lib/api/entries.ts:81–91` decomposes with NFD and strips the
combining marks:

```ts
text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")…
```

For `ü` that is `u` + a diaeresis, and the diaeresis goes. Correct for French
and Vietnamese, where the accent is a diacritic on a vowel; wrong for German,
Swedish and Finnish, where `ä ö ü` are letters that expand — `ae oe ue` — or
are simply other vowels.

There is a second `slugify`, in `lib/ingest/entry.ts:66–79`, which carries a
`TRANSLITERATIONS` table (`:55–64`) for exactly this class of problem: `ø→o`,
`æ→ae`, `œ→oe`, `ß→ss`, `đ→d`, `þ→th`, with a docblock explaining that without
them *"Ærøskøbing" slugs to "rskbing", which is the sort of URL you only notice
after it has been shared*. It does not cover the German umlauts either — NFD
takes them apart before the table would matter — but it is otherwise strictly
better than the API's copy, and the two are not the same function.

So the same day title gets one slug when it arrives through ingest and another
when it arrives through the API or MCP. `lib/validate/entry.ts:22` already
points at the API copy as though it were the canonical one. Two implementations
of a permanent identifier is the real finding; the umlaut is how it surfaced.

## Work

One `slugify`, in one place, used by `lib/api/entries.ts`, `lib/ingest/entry.ts`
and `lib/validate/entry.ts`. Start from the ingest version, which has the
transliteration table and the reasoning behind it.

Add the two-letter expansions for `ä ö ü` (and `Ä Ö Ü`) *before* the NFD pass,
the way the existing table entries run first. Decide deliberately what to do
about Scandinavian `å` and Nordic `ö`, where `aa`/`oe` is not always what a
Swedish or Danish reader would expect — this is a place where being consistent
matters more than being right in every language, and whichever rule is picked
should be written down next to the table.

Explicitly **not** in scope: rewriting slugs of days that already exist.
Existing permalinks stay as they are; anything else breaks links that have been
shared, which is the same harm from the other direction. If a migration is ever
wanted, it needs redirects and its own task.

Check while there whether `lib/mail/index.ts:22`, `lib/api/media.ts:103` and
`scripts/postcard.ts:63` — three further private copies of the same idea —
should join the shared one or are genuinely doing something else. `lib/flags.ts:36`
and `scripts/build-country-codes.mjs:37` are diacritic-stripping for matching,
not slugs, and should be left alone.

## Acceptance

- `slugify("Rückfahrt")` is `rueckfahrt`, from every call site.
- A test table covering `ü ö ä ß æ ø đ` and a Vietnamese title with tone marks,
  asserted against one exported function.
- No second implementation left in `lib/api/entries.ts` or `lib/ingest/entry.ts`.
