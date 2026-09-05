---
id: B469
title: The contacts admin page ignores the language the owner picked
type: ISSUE
priority: medium
complexity: low
area: contacts, i18n
found: "2026-09-05T17:15:00Z"
started: "2026-09-05T15:04:59Z"
session: e5747799-fd3e-4d40-a335-82fa4e24333e
claimed: "2026-09-05T15:04:59Z"
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
