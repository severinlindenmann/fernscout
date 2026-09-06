---
id: B639
title: Address autofill and the place picker no longer respond on the contacts page
type: ISSUE
priority: high
complexity: low
area: contacts, address lookup
found: "2026-09-06T17:51:56Z"
---

# B639 — Address autofill and the place picker no longer respond on the contacts page

## Why

Reported: on `/<user>/contacts`, filling in a postal address, the address
autofill and the place picker no longer respond. `AddressLookupField` is wired
in at `components/ContactsAdmin.tsx:743` behind
`isEnabled("addressLookup", username)` (B399), so the first question is whether
the capability is on for that journal on the live instance and the second is
whether the lookup route is answering.

Reported as "a feeling" rather than reproduced, so establish the fact before
changing anything: it may be the capability, the upstream provider, a rate
limit, or a client-side error nobody sees.

## Work

- Reproduce on the live instance first, with the console open — `/api/health`
  says whether the capability is on and why not.
- Then fix the actual cause. If it is upstream refusing or rate-limiting, the
  field must say so rather than sitting silent; a lookup that fails invisibly
  is what made this take a week to notice.

## Acceptance

- Typing an address on `/<user>/contacts` offers suggestions again, or the
  field states plainly why it cannot.
- Whatever the cause was, the silent-failure path is gone.
