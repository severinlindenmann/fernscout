---
id: B639
title: Address autofill and the place picker no longer respond on the contacts page
type: ISSUE
priority: high
complexity: low
area: contacts, address lookup
found: "2026-09-06T17:51:56Z"
started: "2026-09-06T19:00:28Z"
merged: "2026-09-06T19:08:31Z"
completed: "2026-09-07T13:12:52Z"
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

## Diagnosis

Could not reproduce against the live instance from this sandbox (no network
egress to `fernscout.ch`, and no owner session to drive `/<user>/contacts`
in a browser here). What was established by reading the whole chain
(`components/AddressLookupField.tsx` → `app/api/address-lookup/route.ts` →
`lib/addressLookup.ts` → `photon.komoot.io`) and by testing it directly:

- **The silent-failure path is real and unconditional**, independent of
  whatever actually happened on the live journal. `lookupAddresses()` in
  `lib/addressLookup.ts` caught every failure — a bad configured URL, the
  provider timing out, the provider answering non-200, a malformed body —
  and returned `[]` in every case, by design (the old doc comment said so
  explicitly). The route then answered `200 { results: [] }`, and the field
  rendered nothing. That is bit-for-bit the same response as "no address
  matched", so a provider that is down, rate-limited, or misconfigured looks
  identical, on the wire and on screen, to a query with no results. This is
  what let the report sit as "a feeling" for a week: nothing ever logged,
  nothing ever showed, at any layer.
- **The capability switch, the rate limiter, and the request wiring are all
  fine** — read `lib/capabilities.ts`'s `addressLookup` entry and
  `app/api/address-lookup/route.ts` line by line, and exercised both with
  `test/address-lookup-route.test.ts`. The route correctly 404s when the
  capability is off, 400s below/above the query-length bounds, and 429s a
  flood. None of those was the mechanism the "a feeling" report describes,
  because the client never even calls the route unless the page's own
  `isEnabled("addressLookup", username)` prop is true.
- **What could not be established from here:** whether the live journal's
  capability is actually on, and whether `photon.komoot.io` was refusing or
  rate-limiting requests from the VPS's IP that week. Check `/api/health` on
  the running instance for the capability's own status, and check the
  provider's own uptime/abuse policy for the window in question — both
  answer instantly and neither needs code.

## What changed

The always-`[]`-on-failure contract was the bug, so it is gone:
`lookupAddresses()` now returns `AddressSuggestion[] | null` — `[]` is a
genuine "provider says no matches", `null` is "the provider could not be
asked or refused to answer". The route turns `null` into `502
{ error: "lookup_unavailable" }` instead of `200 { results: [] }`.
`AddressLookupField` tracks that as a `failed` state distinct from an empty
suggestion list, and shows a new `unavailable` message (in every locale,
`contact.addressLookupUnavailable`) in the same slot the suggestion list
would occupy, rather than nothing. A query above `MAX_QUERY_LEN` (200 chars)
is now also skipped client-side before it is sent, so a pasted block of text
does not read as "the lookup is broken" — it was never a real address query.

Tests: `test/address-lookup.test.ts` (module-level null-vs-empty-list),
`test/address-lookup-route.test.ts` ("a refusal is 502, not a 200 with an
empty list (B639)" — the one check for the failure path this ticket asked
for). `npm run verify` passes in full.
