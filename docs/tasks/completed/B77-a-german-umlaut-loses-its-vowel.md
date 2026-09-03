---
id: B77
title: A German umlaut loses its vowel in a slug, and two slugify functions disagree about the rest
type: ISSUE
priority: low
complexity: low
area: api, ingest, slugs
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
completed: "2026-09-03"
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

Add the two-letter expansions for `ä ö ü` (and `Ä Ö Ü`) *before* the NFD pass.
(Corrected while building: the existing table entries did **not** run first —
`lib/ingest/entry.ts` decomposed with NFD and applied `TRANSLITERATIONS`
afterwards. That worked only because `ø æ œ ß đ þ` have no canonical
decomposition, so NFD leaves them untouched; `ü` does decompose, so an entry
for it added in that position would never have fired. And "before NFD" is not
quite enough either: macOS hands filenames over already decomposed, so the
text has to be composed with NFC first or a `ü` read off a memory card is
`u` + a combining diaeresis and no table entry matches it.) Decide deliberately what to do
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

## Built

`lib/slug.ts` — one `slugify`, imported by `lib/api/entries.ts` (which is what
the REST route and the MCP `add_day` tool both write through) and by
`lib/ingest/index.ts`. Neither module has an implementation of its own any
more. `lib/validate/entry.ts:22` now points at `lib/slug.ts` rather than at the
API copy.

The order is: NFC → transliteration table → lowercase → NFD → strip combining
marks → collapse to hyphens → trim → cut to 60 → trim again. The two NFD-order
corrections above are why the first and fourth steps are both there. The cut is
new to the ingest path (the API copy always had a 60-character cap, ingest did
not) and it is now followed by a second hyphen trim, because slicing can land
on one.

**The rule for letters that are not ASCII**, written out in full next to the
table in `lib/slug.ts` and picked by the shape of the letter, since a slug
function gets no language tag:

- a vowel carrying a **diaeresis** expands to vowel + `e` — `ä ö ü` → `ae oe
  ue`. This is the German rule and it is the one that keeps two words apart:
  `ruckfahrt` is a different word from `rueckfahrt`.
- a letter whose **two-letter form is its own name** keeps it — `æ œ ß þ` →
  `ae oe ss th`.
- **everything else** goes to the nearest single ASCII letter — `ø å đ ð ł` →
  `o a d d l`.

So Swedish "Malmö" becomes `malmoe` rather than `malmo`, which is ungainly but
still reads as Malmö; the other way round loses the German word entirely.
Scandinavian `å` stays `a` — the ring is not a diaeresis, and Danish `aa` would
be a third convention in the same table. `ø` stays `o` because that is what it
already produced and slugs exist under that spelling. Nothing except `ä ö ü`
changed meaning; every other letter maps exactly as `lib/ingest/entry.ts`
mapped it before.

No migration, as scoped: days that already exist keep their slugs.

### The three other copies

Checked, and all three stay where they are, each with a comment saying why:

- `lib/api/media.ts:safeSlug` — normalises a slug the caller *already holds*
  into a directory name and a lookup key. Its empty case is load-bearing: the
  caller answers 400 on `""`, whereas `slugify` falls back to `"entry"` and
  would turn a `day=!!!` into a lookup for a day called "entry".
- `lib/mail/index.ts:slug` — half of a local `.eml` filename in a gitignored
  folder, joined to a timestamp that keeps it unique. Nothing resolves it.
- `scripts/postcard.ts:slug` — the base name of generated PDFs in a gitignored
  folder, rewritten on every run.

The shared function is about *permanent public identifiers*; these three name
disposable files. Folding them in would have meant giving `slugify` options
(the fallback word differs in all three), and a parameterised slug rule is a
weaker guarantee than an unparameterised one — it invites exactly the drift
this task removed.

`lib/flags.ts:36` and `scripts/build-country-codes.mjs:37` untouched, as scoped.

### Noticed, not fixed

- `lib/mail/index.ts:slug` has no NFD pass at all, so an accented subject line
  becomes hyphens: "Grüße vom Weg" is `gr-e-vom-weg`. Cosmetic, dev-only
  filenames.
- `scripts/postcard.ts:slug` has no fallback, so a recipient whose name has no
  ASCII in it gets an empty base name — `.pdf`, `-front.pdf` — hidden files,
  and every such recipient overwrites the last.
- `npm run ingest` does not start, on `main` as well as here: `node
  scripts/ingest.ts` reaches `lib/validate/entry.ts:12`, whose
  `import … from "../costFormat"` has no `.ts` extension for Node's resolver.
  Unrelated to this task and left alone; the ingest tests exercise the module
  directly, so the suite does not see it.

## Acceptance

- `slugify("Rückfahrt")` is `rueckfahrt`, from every call site.
- A test table covering `ü ö ä ß æ ø đ` and a Vietnamese title with tone marks,
  asserted against one exported function.
- No second implementation left in `lib/api/entries.ts` or `lib/ingest/entry.ts`.

Evidence, in order:

1. `slugify("Rückfahrt")` is `rueckfahrt`. Both writing doors reach it: the
   REST route (`app/api/v1/[user]/trips/[trip]/days/route.ts:120`) and the MCP
   tool (`lib/mcp/tools.ts:556`) call `createDraft`, which calls the shared
   function, and `lib/ingest/index.ts:470` calls the same import. Asserted
   end-to-end in `test/agent-interface.test.ts` ("the slug on disk is the one
   the shared rule produces": the file written is `2026-01-02-rueckfahrt.md`)
   and at the ingest filename in `test/ingest-run.test.ts`.
2. `test/slug.test.ts` — a 19-row table over `ü ö ä ß æ ø œ þ ł đ ð`, three
   Vietnamese titles with tone marks, French and Spanish accents, plus the
   NFC/NFD-input case, the fallback and the length cut. 23 tests, all against
   the one exported `slugify`.
3. `grep -rn "function slugify" lib app scripts` returns one line,
   `lib/slug.ts`.

Before the change, for the record: `"Ærøskøbing"` slugged to `aeroskobing`
through ingest and `r-sk-bing` through the API — the same title, two permanent
URLs.
