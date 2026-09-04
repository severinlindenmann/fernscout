---
id: B139
title: The costs page's tab title is English on a journal that is not
type: ISSUE
priority: low
complexity: low
area: i18n, costs, ui
found: "2026-09-03"
started: "2026-09-04T06:22:42Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:42Z"
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
