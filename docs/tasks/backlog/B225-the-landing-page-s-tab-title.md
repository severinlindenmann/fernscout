---
id: B225
title: The landing page's tab title is English over a translated page
type: ISSUE
priority: low
complexity: low
area: i18n, landing, metadata
found: "2026-09-04"
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
