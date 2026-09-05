---
id: B465
title: The postcard preview follows the journal's language, not the reader's chosen one
type: ISSUE
priority: high
complexity: low
area: postcards, i18n
found: "2026-09-05T17:00:00Z"
---

# B465 — The postcard preview follows the journal's language, not the reader's chosen one

## Why

B461 moved every string on `/<user>/postcards/<id>` into the three locale
files, and the page is **still English** for an owner who has picked DE in the
switcher. The translations are fine; the page is asking the wrong question.

`app/[user]/postcards/[id]/page.tsx` resolves its locale as
`pickLocale(user.defaultLocale)` — *the journal's* language. The example
journal's default is `en`, so it renders English whatever the reader chose.
The switcher in the header is setting a cookie nothing on this page reads.

`app/[user]/me/page.tsx` already draws the line and even names it: `uiLocale`
comes from `requestLocale()`, the reader's own choice, while `pickLocale(...)`
is used only for *a contact's* language — a fact about that person, not about
the person looking at the screen. The preview page conflated the two.

Same bug, same file, in the `<NoticeShell>` a signed-out visitor gets.

## Work

- Take the page's UI locale from `requestLocale()`, as `/[user]/me` does, and
  keep `defaultLocaleFor(username)` for what it is actually about: the
  fallback for an order that predates `payload.locale`.
- Check the same mistake is not in `/<user>/contacts`, which was where this
  page's gate was copied from.
- While there: the cost line reads "15 credits each × 1 = 15 credits You have
  220." — two sentences run together because the balance string was appended
  with a bare space and carries no leading punctuation.

## Acceptance

- With DE chosen in the switcher, the preview page is German — on a journal
  whose own default is English.
- With no cookie set, it falls back to the journal's language as before.
- The cost and balance read as two sentences.
