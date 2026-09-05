---
id: B251
title: The 404 page's tab title is the bare site name, because not-found.tsx exports metadata Next never asks for
type: ISSUE
priority: low
complexity: medium
area: i18n, metadata, 404
found: "2026-09-04T09:45:51Z"
started: "2026-09-05T15:05:00Z"
merged: "2026-09-05T15:17:17Z"
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

## Decision

Went with (a): `app/layout.tsx`'s static `metadata` became a `generateMetadata`
whose `title.default` is `translateIn(await requestLocale(), "err.notFoundTitle")`.
Not (b): `global-not-found.tsx` needs `experimental.globalNotFound`, its own
fonts, styles and `<html lang>` — a bigger, flag-gated diff to solve a `low`
priority ticket, and the docs are explicit that it exists for apps with
*multiple* root layouts or a dynamic top-level segment in the root layout
itself, neither of which is true here (`[user]` is one level under it).

Checked the blast radius before committing to (a): every real route under
`app/` already carries its own `metadata` or `generateMetadata` **except**
`app/welcome/page.tsx`, which is a bare `redirect("/")` that never renders a
document, and `app/not-found.tsx`. So `title.default` changing to a
translated "not found" string changes nothing for any page that actually
paints — confirmed with `grep -rl "export.*Metadata|generateMetadata" app`
against `find app -name page.tsx -o -name layout.tsx`.

The `robots` half of the same block turned out to need more than a one-line
tweak, and is now more than the ticket's own diagnosis. Building and curling
first: the double meta on `/nobody-here` isn't specific to unmatched routes.
`notFound()` is called directly from ~40 sites across `app/` (an unknown
username in `app/[user]/layout.tsx`, a disabled capability, a missing trip,
day or postcard order…), and every one of them bubbles to this same
`app/not-found.tsx` under this same root layout. Confirmed by curling
`/nosuchuser123` (a real 404 path, not the literal-typo case the ticket
named) before and after: same two-meta bug, same fix. Next's own
`<meta name="robots" content="noindex"/>` on a `notFound()` boundary is an
injection into the response, not a merge into the resolved `Metadata` object
(the file-conventions doc says "injects"; the behaviour confirms it — the
parent's `robots` field survived alongside it rather than being overridden).
So no `generateMetadata`, root or otherwise, can conditionally suppress it for
"only the 404 case": the one lever available is to stop asserting a `robots`
value that conflicts with it in the first place.

Root's `robots: {index:true, follow:true, googleBot:{...,"max-image-preview":
"large"}}` is deleted rather than special-cased. It cost nothing real: a page
with no `robots` meta at all is indexed by default anyway, which is all that
block was asserting for the handful of pages that relied on inheriting it
(the landing page, four `/docs/*` pages, and a public journal's `[user]`
layout when its own computed `robots` is `undefined`). The one thing also lost
is the `max-image-preview: large` hint, never load-bearing for correctness;
not re-added anywhere, per "don't leave half done" balanced against "don't
gold-plate" — a route that wants it back can set it itself, in a separate
capture if it turns out to matter.

## What changed

- `app/layout.tsx`: static `metadata` → `generateMetadata`, translated
  `title.default`, `robots` block removed entirely (see Decision).
- `app/not-found.tsx`: deleted the dead `generateMetadata` (and its now-unused
  imports); left a comment pointing at where the title and the `noindex` now
  come from.
- `test/landing-metadata.test.tsx`: updated the comment above the "every page
  outside a journal" describe block — it referenced the now-deleted function
  by name and needed to say what actually replaced it (still deliberately no
  unit assertion for the 404: this is exactly the case where a direct call
  passing proves nothing about what the framework serves).

## Evidence

Built with `npm run build`, started with `npm run start` on port 3702.

Baseline (before this change, same build tooling), confirming the bug:

```
$ curl -s -H 'Cookie: fs.locale=de' localhost:3701/nobody-here-xyz -w '%{http_code}\n'
404
$ grep -o '<title>[^<]*</title>' page.html
<title>Fernscout</title>
$ grep -o '<meta name="robots"[^>]*/>' page.html
<meta name="robots" content="noindex"/>
<meta name="robots" content="index, follow"/>
```

After the fix, German and Hungarian, both a literal unmatched path and an
unknown-username 404 (the `app/[user]/layout.tsx` `notFound()` trigger, not
the one the ticket named — checked because the fix has to cover it too):

```
$ curl -s -H 'Cookie: fs.locale=de' localhost:3702/nobody-here-xyz -w 'http_status=%{http_code}\n'
http_status=404
$ grep -o '<title>[^<]*</title>' de.html
<title>Nicht gefunden</title>

$ curl -s -H 'Cookie: fs.locale=hu' localhost:3702/nobody-here-xyz -w 'http_status=%{http_code}\n'
http_status=404
$ grep -o '<title>[^<]*</title>' hu.html
<title>Nem található</title>

$ grep -o '<meta name="robots"[^>]*/>' de.html; grep -o '<meta name="robots"' de.html | wc -l
<meta name="robots" content="noindex"/>
       1

$ curl -s -H 'Cookie: fs.locale=de' localhost:3702/nosuchuser123 -w 'status=%{http_code}\n'
status=404
$ grep -o '<title>[^<]*</title>' unk.html
<title>Nicht gefunden</title>
$ grep -o '<meta name="robots"[^>]*/>' unk.html; grep -o '<meta name="robots"' unk.html | wc -l
<meta name="robots" content="noindex"/>
       1
```

Landing page (`/`) still 200s and now carries no `robots` meta at all (was
`index, follow`) — confirms the removed default cost nothing real:

```
$ curl -s localhost:3702/ -w 'status=%{http_code}\n' -o landing.html
status=200
$ grep -c '<meta name="robots"' landing.html
0
```

"Nothing in `app/` exports a `generateMetadata` the framework does not call":
`grep -rn "generateMetadata" app` now has exactly one hit outside
`app/layout.tsx` and `app/not-found.tsx`'s own doc-comment mentioning the
term — every other `generateMetadata` in `app/` belongs to a `layout.tsx` or
`page.tsx` Next actually renders.

`npm run verify`: build → tsc → eslint → vitest, all four stages passed.
229 test files, 3126 tests passed, 3 skipped (the two Postgres-dialect tests
that need a local Postgres, unrelated to this change). 7 pre-existing eslint
warnings, none in a file this ticket touched.
