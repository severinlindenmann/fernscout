---
id: B852
title: A journal's languages, units and currencies cannot be changed anywhere
type: FEATURE
priority: medium
complexity: medium
area: journals, ui
found: "2026-09-07T17:02:27Z"
started: "2026-09-11T06:40:40Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T06:40:40Z"
---

# B852 — A journal's languages, units and currencies cannot be changed anywhere

## Why

`JOURNAL_PROFILE_FIELDS` (`lib/journals.ts:758`) lists ten writable fields.
`/<user>/me` exposes two. The rest — `locales`, `defaultLocale`, `units`,
`displayCurrencies`, `startLocation`, manual rates, the owner's telephone, and
**the journal's own `public`/`guest` visibility** — have **no web surface
anywhere on this instance**, for anybody, with or without the helper.

B838 has just made the wizard ask about languages at signup, which sharpens the
problem rather than solving it: a person is now asked a question they can never
revisit, and every journal created before today is stuck with whatever the
browser's locale happened to be.

Journal visibility is the one with consequences: it decides whether this server
advertises the journal at all — on `/documentation.txt`, on the landing page,
in `sitemap.xml`. Somebody who chose `public` at signup and later wants to be
unlisted has no way to say so.

## Work

A settings panel on `/<user>/me`, or a screen in the helper, over the fields
`setJournalProfile` already accepts and validates. It refuses `baseCurrency`
deliberately — say so on the screen rather than omitting the field silently, so
nobody hunts for it.

Languages need the same sentence B838 puts on the signup form: adding one is a
promise to write every day again in it, and a day missing one is refused.

## Acceptance

An owner can change their journal's languages and whether it is advertised,
from a page, and is told which field cannot be changed and why.
