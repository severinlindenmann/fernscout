---
id: B1619
title: v2's day translations field has no journal-locale check at all, unlike v1's
type: ISSUE
priority: medium
complexity: medium
area: API v2
found: "2026-09-12T20:20:41Z"
---

# B1619 — v2's day translations field has no journal-locale check at all, unlike v1's

## Why

B294 required a day to carry its prose in every language its journal
declares, and v1 enforced it with a check that knew the journal's own
`locales`/`defaultLocale`: it named a locale the journal does not declare
(`translations.fr`), named the day's own language duplicated under
`translations` (`translations.de`), and named exactly which declared
language was still missing ("Missing hu"). That check lived in the write
ROUTE, not in the day's own validator, because it needs the journal's config
to run.

v2's `dayWrite` (`lib/api/v2/schemas/day.ts`) has a `translations` field —
`z.record(z.string(), z.strictObject({title, content}))` — but nothing
cross-references it against the journal's locale list: a grep of every v2
day/trip route for `locale` or `defaultLocale` finds nothing. The field's
own comment says the check "needs the journal's config and lives at the
door", but no door has it. `DAY_DECLINABLES`' `translations` entry is
satisfied by ANY record value at all — for the wrong language, for the day's
own language, or covering only one of several declared languages — the same
`201` a fully-correct map gets.

Found while repointing `test/day-translations.test.ts` from the deleted v1
`.../days` routes onto v2's `PUT`/`PATCH .../days/{slug}` for B1612. The file
now documents this directly: three tests
("v2 currently accepts a translation for a language the journal never
declared", "...the day's own language duplicated...", "...covering only one
of the two languages actually owed") assert the CURRENT, wrong-but-honest
201, specifically so a fix has failing tests to flip rather than passing
ones that hide the gap.

## Work

- Add the journal-locale-aware check to `PUT`/`PATCH
  .../days/{slug}` (`app/api/v2/[user]/trips/[trip]/days/[slug]/route.ts`),
  reading the journal's `locales`/`defaultLocale` the way v1's route did.
- Decide the v2-shaped refusal: a `problems`-style row per bad key
  (`translations.fr`, `translations.de`) fits the existing `invalid_entry`/
  `invalid_request` problem list better than a bespoke shape — check
  `lib/api/v2/incomplete.ts`'s `ProblemRow` for what already exists to reuse.
  A day still missing a declared language is a DIFFERENT case (incomplete,
  not invalid) and probably wants its own `missing` row via
  `DAY_DECLINABLES`, which will need the check moved earlier or the
  declinable's `whyRequired` reworked to carry which language.
- The trip-level `translations` field (`lib/api/v2/schemas/trip.ts`) has the
  identical gap for a trip's own title/tagline/intro — worth the same fix in
  the same pass rather than a second ticket later.
- Flip the three tests named above in `test/day-translations.test.ts` from
  asserting the gap to asserting the refusal, once fixed.

## Acceptance

- `PUT .../days/{slug}` with `translations: {fr: {...}}` on a
  `locales: ["de","en","hu"]` journal is refused, naming `translations.fr`.
- The same call with `translations.de` (the day's own language) duplicated
  is refused, naming it.
- The same call missing one declared language is refused, naming it.
- `test/day-translations.test.ts`'s three "v2 currently accepts..." tests are
  updated to assert refusal and pass.
