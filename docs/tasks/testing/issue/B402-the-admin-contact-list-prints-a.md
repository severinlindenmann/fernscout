---
id: B402
title: The admin contact list prints a saved country code, not its name
type: ISSUE
priority: low
complexity: low
area: contacts, i18n
found: "2026-09-05T07:32:54Z"
started: "2026-09-05T07:35:23Z"
merged: "2026-09-05T08:01:41Z"
session: 39691533-1e0d-44dd-a2e5-b2a7ce844518
claimed: "2026-09-05T08:53:14Z"
---

# B402 — The admin contact list prints a saved country code, not its name

## Why

B398 turned `PostalAddress.country` into an ISO2 code (once a row is saved
through the new picker), but `ContactRow` in `components/ContactsAdmin.tsx:284`
still prints `postal.country` verbatim in the owner's own address summary. A
freshly-saved contact's row now reads "…, CH" instead of "…, Switzerland" —
correct data, worse for the one person who has to read it and put it on an
envelope by hand.

## Work

Render `postal.country` through `resolveCountry` + `countryName` (both in
`lib/countries.ts`, B398) before joining it into the address line, falling
back to the raw string when it does not resolve — exactly the read-time rule
B398 already applies in the edit form, just also applied to the read-only
summary. `ContactRow` does not currently receive the journal's `locales` or
the admin's own `locale`; both are already in scope one level up in
`ContactsAdmin`'s default export and would need threading down, the same way
`t` already is.

Not doing: anything about `postal.country` on disk — this is a display-only
fix, nothing is rewritten by it.

## Acceptance

A contact saved with country `CH` shows "Switzerland" (or the owner's own
locale's name) in the admin's pending/approved list, not the bare code. A
contact with an unresolved legacy string (e.g. "Elbonia") still shows exactly
that string, unchanged.

## Built

`ContactRow` (`components/ContactsAdmin.tsx`) now takes `locale: Locale` and
`locales: string[]`, and renders `postal.country` through
`resolveCountry(postal.country, locales)` then `countryName(iso2, locale)`,
falling back to the raw stored string when it does not resolve — same rule
`CountryField` already applies, now also at read time. `ContactGroup` threads
both props down from the three call sites in `ContactsAdmin`'s default
export, which already had `locale`/`locales` in scope.

`test/contact-country-name.test.tsx` — the acceptance line as written: `CH`
renders "Switzerland", and "Elbonia" renders unchanged.
