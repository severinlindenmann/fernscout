---
id: B398
title: The country on an address is free text, so nothing downstream can tell Schweiz from Switzerland
type: FEATURE
priority: medium
complexity: low
area: contacts, i18n
found: "2026-09-05T00:45:00Z"
started: "2026-09-05T07:23:09Z"
session: 39691533-1e0d-44dd-a2e5-b2a7ce844518
claimed: "2026-09-05T07:23:09Z"
---

# B398 — The country on an address is free text, so nothing downstream can tell Schweiz from Switzerland

## Why

`PostalAddress.country` (`lib/contacts/crypto.ts:53`) is a string somebody
typed. "Schweiz", "CH", "Switzerland", "switzerland " and "Suisse" are five
different countries as far as the code is concerned, and `isPostable`
(`crypto.ts:132`) only asks whether it is non-empty. Nothing can group by
country, no print provider can be handed a country code, and a postcard to
"Schweiz" is a postcard whose destination is a guess.

It matters now because of two things landing around it. B399 wants to fill
this field from a lookup result, which returns an ISO code and not a word in
the owner's language. And B390 just built the country table this needs —
`DIAL_CODES` in `components/TelField.tsx` is iso2 plus dial code, with names
from `Intl.DisplayNames` and flags derived from the letters — so the data and
the rendering both already exist, one component over.

Free text is also the reason the address block is unhelpful outside the DACH
countries: with no country known, the form cannot reorder or relabel its
fields for where the envelope is actually going.

## Work

Store the country as an **ISO 3166-1 alpha-2 code**, and render its name with
`Intl.DisplayNames` in the reader's locale — the same trick B390 used, so the
same country reads "Schweiz" to a German speaker and "Switzerland" to an
English one without a translation table.

Lift the country data out of `TelField.tsx` into something both can import —
`lib/countries.ts` or similar — rather than a second copy. `flagOf` and the
name lookup move with it; `TelField` keeps working unchanged.

The country field becomes a picker with the same searchable behaviour the
phone field has. It is the field a person changes least and searches most, and
a second combobox pattern in the same form would be the wrong kind of
different.

**Legacy rows, as decided:** on read, map a stored string to a code when it is
unambiguous — "CH", "Switzerland", "Schweiz", "Suisse" all resolve to `CH`,
case- and whitespace-insensitively, matched against `Intl.DisplayNames` output
for the locales this journal speaks plus the English name. Anything that does
not resolve stays as the typed text, with nothing selected, exactly as B385
leaves an unparseable phone number. **Nothing is rewritten on disk until
somebody saves that row** — no migration pass, no touching every contact's
encrypted blob.

`isPostable` should keep accepting an unresolved legacy string, or a contact
who has been postable for a year stops being postable on deploy.

Not doing: per-country field order and labels (postcode before city, a state
field for the US). That is worth having and is a separate ticket, once this
one makes the country knowable.

## Acceptance

A new address saves a country as `CH` and displays as "Schweiz" in German and
"Switzerland" in English. A contact whose stored country is the string
"Schweiz" opens with Switzerland selected and, untouched, saves back without
changing. A contact whose stored country is "Elbonia" opens with that text
preserved and nothing selected, and is still `isPostable` if it has a street
and a city. Tests cover all three, and no second copy of the country table
exists (`npm run unused` stays clean).
