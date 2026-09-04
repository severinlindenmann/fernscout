---
id: B139
title: The costs page's tab title is English on a journal that is not
type: ISSUE
priority: low
complexity: low
area: i18n, costs, ui
found: "2026-09-03"
started: "2026-09-04T06:22:42Z"
merged: "2026-09-04T07:11:28Z"
---

# B139 — The costs page's tab title is English on a journal that is not

## Why

Found while fixing B118, which is the same shape of defect on the map page's
metadata: the page body translates and `generateMetadata` does not.

`app/[user]/(trip)/costs/page.tsx:12–32` builds its whole metadata block out of
English literals:

```tsx
title: "Costs",
description: `What the trip actually costs, itemised in ${currency} — …`,
openGraph: { title: "What the trip costs", … },
```

The page underneath renders `t("cost.title")`
(`app/[user]/(trip)/costs/CostsPageContent.tsx:44`), which is
`"Was die Reise kostet"` on a German journal and `"Mennyibe kerül az út"` on a
Hungarian one. So a German reader gets `Kosten`-less English in the browser
tab, in their history, in a bookmark and in any link they share, while the page
in front of them is in German.

This is the exact defect the comment at the top of the map and gallery pages
was written about — "a German reader on a German journal was getting 'Gallery'
there while the page in front of them said 'Galerie'". Both of those were
fixed; the costs page was not, and neither was its `requestLocale` /
`localeForPath` split. The *trip-scoped* costs route already does it correctly
(`app/[user]/trips/[trip]/costs/page.tsx:24–38` calls `translateIn(locale,
"cost.title")`), so the two routes for the same content disagree.

The cost is presentational and small, and it is the same one B118 records: a
tab, a bookmark, a link preview and a shared screenshot all carry the
`<title>`.

## Work

Give `app/[user]/(trip)/costs/page.tsx` the metadata shape its two neighbours
already have — `requestLocale()` for the tab title, `localeForPath(PATH_HEADER)`
for the sharing card, both feeding `translateIn`. `cost.title` exists in all
three dictionaries. Whether a translated *description* needs a new key, or
whether `cost.subtitle` (which already takes a `currency` variable) is the
right string, is the one open question — check before adding a key, because a
new key means `lib/i18n.ts` and `npm run i18n:keys`.

Check `app/[user]/(trip)/page.tsx` while in there: it exports no
`generateMetadata` at all, so the journal's front page inherits whatever the
layout above it says. That may be correct; say which.

Not doing: the costs page's *tense*, which is B19 — a planned trip's costs page
reporting spending that has not happened is a larger copy question than a
`translateIn` call. This task is only about the language.

## Acceptance

- `/<user>/costs` on a German journal returns a `<title>` in German, and it
  matches the `<h1>` the page renders.
- The reader/journal split is preserved: a German reader on an English journal
  gets a German tab title and an English sharing card, as on the map page.
- A test asserts the pairing in all three maintained locales, as
  `test/map-tense.test.tsx` does for the map.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

## What changed

Fixed in `app/[user]/(trip)/costs/page.tsx`. The metadata block now has the
shape its two neighbours have: `requestLocale()` for the tab title,
`localeForPath(PATH_HEADER)` for the sharing card, both through `translateIn`.

The open question in **Work** — whether a translated description needed a new
key — did not: **`cost.subtitle` is the right string** and no key was added.
It is the standfirst the page renders one line under the `<h1>`, it already
takes `{currency}`, and it exists in all three dictionaries. The English
paraphrase that was there ("What the trip actually costs, itemised in CHF —
preparation, flights, beds, food and everything in between") existed nowhere
else and nobody maintained it.

**B165 is untouched.** The `if (!isEnabled("costs", user)) return {}` guard
still comes first, before any locale is resolved: nothing describes a page that
is not there. `test/costs-capability.test.ts` still passes; its `@/lib/locales`
mock grew a `localeForPath` so it keeps describing what the route now imports.

**`app/[user]/(trip)/page.tsx` is correct as it is, and stays.** It exports no
`generateMetadata`, so the journal's front page takes the layout's `default`:
`"<title> — <tagline>"`. Both are the author's own words in their own language,
already read from `config.json`, and there is no chrome string to translate —
`%s · <title>` is the *template* the section pages fill, and the front page is
the one page that has no section name. Giving it a `generateMetadata` would
only restate what it already gets.

**One thing found and not absorbed: B214.** The description is `cost.subtitle`
unconditionally, and the page switches to `cost.subtitlePlanned` on a trip that
has not started (B19's fix, `CostsPageContent.tsx:43`). So on a journal whose
current trip is upcoming, the description is one tense ahead of the standfirst
beneath it. Fixing it means resolving `hasBegun` inside `generateMetadata`, and
`getCostSummary` is not cached — that is a cost/benefit call of its own, which
is why it is B214 and not a line in this diff.

## Evidence

`test/costs-title.test.tsx` — new, 8 tests. Against the code as it was, all
eight fail:

```
AssertionError: expected 'Costs' to be 'What the trip costs'
AssertionError: expected 'Costs' to be 'Was die Reise kostet'
AssertionError: expected 'Costs' to be 'Mennyibe kerül az út'
AssertionError: expected 'What the trip actually costs, itemise…' to be 'Alles, was wir ausgeben, in CHF — von…'
```

It renders the real `CostsPageContent` and reads its `<h1>` out of the markup,
then asserts `generateMetadata`'s title is the same string — in `en`, `de` and
`hu`, as `test/map-tense.test.tsx` does for the map. The reader/journal split
has its own case: a German reader on a journal that offers German gets a German
tab title and an English sharing card.
