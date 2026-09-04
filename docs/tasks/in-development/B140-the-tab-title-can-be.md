---
id: B140
title: The tab title can be in a language the journal does not offer, while the page is not
type: ISSUE
priority: low
complexity: low
area: i18n, ui
found: "2026-09-03"
started: "2026-09-04T06:22:42Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:42Z"
---

# B140 — The tab title can be in a language the journal does not offer

## Why

Found while verifying B118 against a running server. Two places decide which
language a request renders in, and they ask different questions.

`app/[user]/layout.tsx:69–70` — what the *page* renders in:

```tsx
chosen && user.locales.includes(chosen) ? chosen : user.defaultLocale;
```

`lib/locales.ts:240–242` — what `requestLocale()` returns, which every
`generateMetadata` uses for the `<title>`:

```ts
if (chosen && installedLocales().includes(chosen)) return chosen;
```

`installedLocales()` is `MAINTAINED_LOCALES` — every language the *project*
ships chrome for. `user.locales` is what this *journal* offers. So a reader
carrying `fs.locale=de` from one journal, landing on an English-only journal
on the same instance, gets:

```
$ curl -s -H 'Cookie: fs.locale=de' http://localhost:3178/<en-only>/map
<title>Wohin wir wollen · …</title>
<h1 …>Where we're going</h1>
```

That is the same defect B118 was about — the tab title disagreeing with the
heading below it — with a different cause. It affects every page whose title
comes from `requestLocale`, not the map alone. A journal that *does* offer the
language is correct in both places, which is what narrows this to the
mismatched test.

The cookie is per-instance, not per-journal, so a multi-journal instance is
where this shows up: pick German on one person's journal, then open somebody
else's English-only one.

The cost is presentational and small, but it is the exact confusion the
comment at the top of the map and gallery pages was written to prevent, in
reverse: the tab now says one thing and the page another.

## Work

Decide which of the two rules is right and use it in both places. The likely
answer is that `requestLocale()` should narrow to the journal being read —
`localesFor(username)` rather than `installedLocales()` — because the language
the reader gets in the tab should be the language they are about to see.

The obstacle is that `requestLocale()` takes no arguments and reads the journal
out of `PATH_HEADER`; `localeForPath` already turns that header into a
username, so the information is present and the narrowing can happen inside
`requestLocale` without changing a single call site. Check the pages that are
not inside a journal — the landing page, `/welcome`, the notices — where
`localeForPath` returns the instance locale and there is no `user.locales` to
narrow against.

Not doing: the reader/journal split itself. The tab title following the reader
and the sharing card following the journal is deliberate and documented at
`app/[user]/(trip)/map/page.tsx`; this is only about which readers' choices
count.

## Acceptance

- A request carrying `fs.locale=de` to a journal whose `locales` are `["en"]`
  returns a `<title>` and an `<h1>` in the same language.
- A request carrying `fs.locale=de` to a journal that offers German still gets
  German in both — the narrowing must not undo B-era work that made the tab
  follow the reader at all.
- A test asserts both, since the two rules live in different files and nothing
  currently makes them agree.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
