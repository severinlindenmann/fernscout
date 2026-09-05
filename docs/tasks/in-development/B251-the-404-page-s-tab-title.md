---
id: B251
title: The 404 page's tab title is the bare site name, because not-found.tsx exports metadata Next never asks for
type: ISSUE
priority: low
complexity: medium
area: i18n, metadata, 404
found: "2026-09-04T09:45:51Z"
started: "2026-09-05T15:05:00Z"
session: e5747799-fd3e-4d40-a335-82fa4e24333e
claimed: "2026-09-05T15:05:00Z"
---

# B251 — The 404 page's tab title is the bare site name, because not-found.tsx exports metadata Next never asks for

## Why

`app/not-found.tsx:20` exports a `generateMetadata` that resolves the reader's
language and returns `err.notFoundTitle` and `robots: noindex`. Next never
calls it. Against a production build:

```
$ curl -s -H 'Cookie: fs.locale=de' localhost:3700/nobody-here | grep -o '<title>[^<]*</title>'
<title>Fernscout</title>
```

The body of that same response is entirely German — the German dictionary is in
the payload and `NotFoundNotice` renders from it — while the tab says the
instance's name and nothing else. "Nicht gefunden" is in `de.json`, translated,
and unreachable.

`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`
is the reason: `not-found.js` has no metadata export in its API surface, and
the title falls back to the nearest layout's — here `app/layout.tsx`'s
`title.default`, which is `serverSite().name`. Metadata on a 404 is
`global-not-found.js`, which is experimental and needs
`experimental.globalNotFound` in `next.config.ts`.

Two things follow, and the second is the expensive one:

- The same response carries `<meta name="robots" content="noindex"/>` (Next's
  own, for the not-found boundary) **and** `<meta name="robots" content="index,
  follow"/>` from the root layout. One page, two directives, and a crawler
  picks.
- A test can call the function directly and pass — `test/reader-locale.test.tsx`
  does exactly that for the gallery, and the shape invites it here. So the
  dead export looks covered.

Found while verifying B225's third acceptance line ("no page outside a journal
has an untranslated title while its body is translated"). Not absorbed into it:
B225 is a missing string on the landing page and its fix is two dictionary
entries, while this one is a string that exists and a Next file convention that
will not read it. `/` and `/offline` were checked at the same time and are
correct.

## Work

- Decide where a 404's title comes from. The candidates are the root layout
  growing a `generateMetadata` whose `title.default` is translated — which
  changes the fallback title for every page that has none — or
  `app/global-not-found.tsx` behind the experimental flag, which bypasses the
  layout and would need its own fonts, styles and `<html lang>`.
- Whichever is chosen, delete or rewire the export in `app/not-found.tsx`:
  code nothing calls, which a test can call anyway, is worse than none.
- Settle the two `robots` metas while there.

Not doing: the notice's body, which is right.

## Acceptance

- `curl -s -H 'Cookie: fs.locale=de' <host>/nobody-here` returns a German
  `<title>`, and the same request with `fs.locale=hu` a Hungarian one.
- The response carries one `robots` directive, and it says `noindex`.
- Nothing in `app/` exports a `generateMetadata` that the framework does not
  call.
