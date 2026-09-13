---
id: B1667
title: Trip translations section is required even on single-locale journals, contradicting decision and its own schema comment
type: ISSUE
priority: high
complexity: low
area: api-v2
found: "2026-09-13T13:55:05Z"
merged: "2026-09-13T14:28:06Z"
---

# B1667 — Trip translations section is required even on single-locale journals, contradicting decision and its own schema comment

## Why

`docs/v2-migration/00-decisions.md` states: "translations {title,tagline,intro}
declinable when journal has >1 locale". `TRIP_DECLINABLES` in
`lib/api/v2/schemas/trip.ts:143-146` even writes its own `whyRequired` text
to match: *"a journal that maintains several languages carries each trip's
title and tagline in all of them, or says why not (a single-language journal
is exempt — the route skips this check)"*.

That exemption does not exist anywhere in the code. `tripCreate`'s
`superRefine` (`lib/api/v2/schemas/trip.ts:279-282`) always runs
`checkRequiredOrDeclined(doc, [...TRIP_DECLINABLES, ...], ctx)` with the
static `TRIP_DECLINABLES` list, which is journal-context-free — a Zod schema
has no access to the journal's `locales` array at parse time, and nothing in
`app/api/v2/[user]/trips/[trip]/route.ts` filters `translations` out of the
declinables list before calling the schema when the journal has one locale.

Verified live against `https://fernscout.ch`: created a scratch journal
`test-v2review` with `"locales": ["en"]` (single locale) and a
`PUT .../trips/<id>` with every other declinable answered came back 422
still demanding an answer for `translations`, with the exact "single-language
journal is exempt" sentence quoted back as the reason it is being asked
anyway. Every caller against a single-locale journal — which is most
journals — is forced to carry a permanent, meaningless
`declined.translations: "..."` line it should never have had to write, or
the create is refused.

## Work

Make the `translations` question conditional on `journal.locales.length > 1`,
the same way `visibility === "public"` already gates `LISTED_DECLINABLE`
(`trip.ts:279-282`). Since the Zod schema itself cannot see the journal, this
has to happen where the route already has the journal loaded
(`app/api/v2/[user]/trips/[trip]/route.ts`, both the PUT/create and PATCH
paths, and the day equivalent in
`app/api/v2/[user]/trips/[trip]/days/[slug]/route.ts` if `DAY_DECLINABLES`
has the same static `translations` entry — check it too) — either by
building the declinables list per-request before validation, or by adding a
`translations` exemption directly to `checkRequiredOrDeclined`/
`checkPatchConflicts` that takes the locale count as a parameter. Update the
still-accurate parts of the `whyRequired` text if the mechanism changes its
wording, and keep the sentence honest either way — it is quoted verbatim
back to the caller in the 422 body.

## Acceptance

A `PUT`/create against a journal with exactly one locale, with every
declinable other than `translations` answered and `translations` entirely
absent (not declined), succeeds and the stored trip carries no
`declined.translations` key. The same call against a journal with two or
more locales still requires an answer or an explicit decline. Add/extend a
test in `test/api-v2-schemas.test.ts` covering both cases.
