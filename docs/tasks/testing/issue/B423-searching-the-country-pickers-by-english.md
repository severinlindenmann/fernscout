---
id: B423
title: Searching the country pickers by English name finds nothing on a journal that is not in English
type: ISSUE
priority: medium
complexity: low
area: contacts, i18n
found: "2026-09-05T11:55:00Z"
started: "2026-09-05T09:16:44Z"
merged: "2026-09-05T09:22:13Z"
---

# B423 — Searching the country pickers by English name finds nothing on a journal that is not in English

## Why

Found on the live site during the 2026-09-05 campaign, verifying B390 against
`qa-addr-0905`, a journal whose default locale is `de`.

Typing `swi` into the dial-code picker returns "Kein Land passt dazu" — no
country matches. Reproduced twice. `CH` works, `41` works, `Schw` works.

`swi` is the ticket's own flagship example: B390's acceptance says "`swi`, `CH`
and `41` all find Switzerland", and B385's before it said the same. The unit
tests assert it and pass, because they call the filter with `locale: "en"`
where the country is named "Switzerland". On any journal that is not in
English, the string those tests assert against is not the string the filter
sees.

`filterCountries` (`components/TelField.tsx:59-74`) matches
`countryName(iso2, locale)`, the iso2 code, and the dial digits. One display
name, in one locale. `resolveCountry` in `lib/countries.ts` faces the same
problem from the other side and solves it — it tries `[...locales, "en"]` —
which is the pattern this should have followed and is why the inconsistency is
worth fixing rather than documenting.

B398's `filterCountryList` shares the limitation and is worse off: it drops the
dial digits, so a German-locale owner looking for Switzerland in the postal
address field has neither `swi` nor `41`, only `Schw` or `CH`. Not directly
tested on the live site; same code path.

Who this costs: somebody typing a country they know in English into a journal
kept in German — which is most people entering an address for a family member
abroad, and exactly the international case B385 and B390 were built for.

## Work

Match against the English name as well as the journal's locale name, the way
`resolveCountry` already does. One `tried = [...locales, "en"]` in the filter,
deduplicated.

While there: give `filterCountryList` the dial-digit match too, or say in a
comment why the postal picker deliberately does not have it. The two filters
are one function's worth of behaviour split in two and drifting.

The tests must assert the non-English case, or this comes back — the current
ones pass against exactly the locale that cannot fail.

## Acceptance

On a journal whose locale is `de`, typing `swi` into both the dial-code picker
and the postal country picker finds Switzerland, and `Schw`, `CH` and `41`
keep working. A test asserts the filter with `locale: "de"` and an English
query, and fails against today's code.

## Resolution

Added `matchesName(iso2, q, locale)` to `lib/countries.ts` — the `[...locales,
"en"]` idea `resolveCountry` already used, shrunk to the one locale a live
filter has (`[locale, "en"]`, deduplicated). Both `filterCountryList`
(`lib/countries.ts`) and `TelField`'s `filterCountries`
(`components/TelField.tsx:59-74`) now call it instead of comparing against
the locale-only name directly, so the fix lives once rather than twice — the
two-line shared helper the ticket suggested, not a merge of the two functions
(one still carries the dial-code branch, the other still doesn't; unifying
them would mean threading an "include digits" flag through for no shared
behaviour left to save).

`filterCountryList`'s existing "no dial digits" comment already said why the
postal picker has no digit match (nothing there is a phone number) — left as
is, since it already answers the ticket's second question, and strengthened
slightly to say so explicitly.

New tests in both `test/tel-field.test.ts` and `test/countries.test.tsx`
assert `locale: "de"` with query `"swi"`; both were confirmed to fail against
the pre-fix code (stashed the two source files, ran the suite, saw both new
cases fail with "expected false to be true", then restored and saw both
pass).

Verified by hand post-fix: on `locale: "de"`, `filterCountries` finds
Switzerland for `swi`, `Schw`, `CH` and `41`; `filterCountryList` finds it for
`swi`, `Schw` and `CH`.

`npm run verify` (build, tsc, eslint, vitest — 2860 passed, 3 skipped for no
local Postgres) and `npm run unused` both clean; no new unused exports.
