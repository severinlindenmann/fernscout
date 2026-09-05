---
id: B469
title: The contacts admin page ignores the language the owner picked
type: ISSUE
priority: medium
complexity: low
area: contacts, i18n
found: "2026-09-05T17:15:00Z"
started: "2026-09-05T15:04:59Z"
merged: "2026-09-05T15:17:18Z"
---

# B469 — The contacts admin page ignores the language the owner picked

## Why

Found while fixing B465, which is the same mistake one page over — the
postcard preview's gate was copied from this file, and the bug came with it.

`app/[user]/contacts/page.tsx:51` resolves the page's language as
`pickLocale(user.defaultLocale)`: **the journal's** default, not the reader's.
An owner who picks German in the switcher gets the whole guest-list admin
panel in the journal's language regardless — English, on a journal written in
English by somebody who reads German.

`app/[user]/me/page.tsx` is the file that has it right, and names the
distinction: `uiLocale` from `requestLocale()` is the person looking at the
screen; `pickLocale(contact.locale, journal.defaultLocale)` is a fact about
*somebody else* — which language a given contact is written to in. The two are
different questions and this page asks the wrong one for its chrome.

Note the panel legitimately needs `pickLocale` too, for the per-contact
language it displays and sets. Both belong here; only the page's own chrome is
wrong.

## Work

- Take the page's UI language from `requestLocale()`.
- Keep `pickLocale(...)` for each contact's own locale, which is what it is
  for.
- The `NoticeShell` shown to a signed-out visitor takes the same locale, so it
  moves with it.

## Acceptance

With DE chosen in the switcher, `/<user>/contacts` renders in German on a
journal whose own default is English, and each contact still shows their own
language beside their row.

## What changed

`app/[user]/contacts/page.tsx` now reads `const locale = pickLocale(await
requestLocale())` instead of `pickLocale(user.defaultLocale)` — the exact
idiom `app/[user]/postcards/[id]/page.tsx` already uses for the same defect
(B465). Everything downstream of `locale` (the `NoticeShell` for a
signed-out visitor, the dictionary handed to `ContactsAdmin`, the `lang`
attribute) moves with it automatically; nothing else in the file changed.
Each contact row's own language (`contact.locale`, read raw from
`listContacts` at line ~79) was never touched by the bug and is still
untouched by the fix.

Checked the sibling admin surface named in the ticket, `/[user]/me`
(`app/[user]/me/page.tsx`): it already does this correctly — `uiLocale` from
`requestLocale()` for the page's own chrome, `pickLocale(contact.locale,
journal.defaultLocale)` only for the one field that is a fact about somebody
else. It was the model this fix copies, not a second instance of the bug.
`app/[user]/delete/[token]/page.tsx` also reads `user.defaultLocale`
directly, but deliberately: it is a single-use mailed link with no
`PageHeader`, no locale switcher and no browser session to read a choice
from, and its own doc comment says the export it links to is "in the
journal's own language" on purpose. Left alone.

## Evidence

- `test/contacts-admin-locale.test.tsx` (new): builds a real content
  directory for a journal whose default is English and also offers German,
  sets a `de` cookie, and asserts the page's own chrome (`contact.adminTitle`)
  renders in German while a Hungarian contact's row still says "Magyar".
  Confirmed failing against the pre-fix code (asserted "Readers"/English
  chrome) and passing against the fix.
- `test/contacts-way-back.test.tsx` needed a `next/headers` mock and a
  `userExists` export added to its existing `@/lib/users` mock, since the
  page now calls `requestLocale()`, which reads real cookies/headers; without
  the mock it threw "`cookies` was called outside a request scope."
- `npm run verify`: build → tsc → eslint → vitest all passed (230 test
  files, 3128 passed, 3 skipped for Postgres — pre-existing and unrelated).
