---
id: B225
title: The landing page's tab title is English over a translated page
type: ISSUE
priority: low
complexity: low
area: i18n, landing, metadata
found: "2026-09-04"
started: "2026-09-04T09:30:23Z"
merged: "2026-09-04T10:00:32Z"
completed: "2026-09-04T21:54:17Z"
---

# B225 — The front door's tab title is not translated

## Why

Found while verifying **B140**, which passes. This is adjacent to it and has a
different cause, which is why it is its own task rather than a failure there.

`/` with `Cookie: fs.locale=de` on the deployed instance:

```html
<html lang="de">
<title>Fernscout — a travel journal your agent writes</title>
<h1>Ein Reisetagebuch, das dein Agent für dich schreibt.</h1>
```

An English tab title over a German page. The same string comes back under
`fs.locale=hr`, where the page is correctly English — so the title is not
locale-dependent at all. The landing page's metadata simply was never
localised.

This is the third instance of one symptom with three different causes, and
that is the interesting part:

- **B118** — a `<title>` and an `<h1>` disagreeing about *tense*, because
  `generateMetadata` never learned a conditional the heading had.
- **B140/B185** — a `<title>` and a page disagreeing about *language*, because
  metadata resolved the locale from the instance's installed set while the body
  resolved it from the journal's. Fixed by making one rule decide both.
- **B225** — this one. The locale resolution is *correct*; German is offered
  instance-wide and the page renders German. There is just no translated string
  to render into the title.

B140's fix could not have caught it, because nothing here is choosing the wrong
locale.

The cost is cosmetic and it is on the instance's front door — the first thing a
stranger's browser tab says, and what a shared link previews as. Low priority,
but it is the page most likely to be shared.

## Work

- Give the landing page's `generateMetadata` a translated title and
  description, resolved the way B140 now resolves everything else. The strings
  belong in `content/locales/{en,de,hu}.json` beside the landing copy that is
  already translated — the `<h1>` proves the rest of the page has them.
- Check the other pages outside a journal for the same gap while in there:
  `/welcome`, `/offline`, and anything else whose metadata predates the
  localisation work. B140's own note records that `/` was checked for *locale
  choice* and found correct, so these were never checked for *having strings*.

Not doing: changing how the locale is chosen. B140 settled that and it is
right — this page picks the correct language and then has nothing to say in it.

## Acceptance

- `/` with `fs.locale=de` returns a German `<title>`, and with `fs.locale=hu` a
  Hungarian one, matching the language of the `<h1>` beneath.
- A reader whose locale the instance does not maintain still gets the
  instance's own language in both, as today.
- No page outside a journal has an untranslated title while its body is
  translated.

## Built

`app/page.tsx` — the static `metadata` object is now a `generateMetadata` that
resolves `requestLocale()` and renders `landing.metaTitle` (which takes the
instance's name as `{name}`) and `landing.metaDescription`, both new in
`content/locales/{en,de,hu}.json` and in the `TranslationKey` union. Nothing
about locale *choice* changed, as the Work section says: `requestLocale()` is
B140's rule and it was already returning the right answer.

`title` stays `absolute`, because the root layout's `%s · Fernscout` template
would otherwise append the site name to a sentence that already carries it.

Against a production build:

```
$ curl -s -H 'Cookie: fs.locale=de' localhost:3700/ | grep -o '<title>[^<]*</title>'
<title>Fernscout — ein Reisetagebuch, das dein Agent schreibt</title>
$ … fs.locale=hu → <title>Fernscout — útinapló, amit az ügynököd ír</title>
$ … fs.locale=hr → <title>Fernscout — a travel journal your agent writes</title>
```

with `<html lang>` and the `<h1>` agreeing in each case, and `hr` — a language
the instance maintains no chrome for — falling back to the instance's own.

**The other pages outside a journal, which the Work section asked for.**
`/welcome` is a `redirect("/")` and renders no document. `/offline` was already
translated and is verified German under a `de` cookie. The 404 is the one that
is *not* right, and its cause is neither of this ticket's: `app/not-found.tsx`
exports a `generateMetadata` that Next never calls, because `not-found.js` has
no metadata export in its API surface, so the served page takes the root
layout's `title.default` and says "Fernscout" over a fully German body. The
string exists and is translated; the framework does not ask for it. Captured as
B251 rather than absorbed — the fix is a choice about where a 404's title comes
from, not a dictionary entry.

`test/landing-metadata.test.tsx` covers the three acceptance lines it can and
says in a comment why the 404 is deliberately not asserted there: a test that
calls that function directly passes while the page a reader gets does not,
which is the exact failure mode this ticket is about.
