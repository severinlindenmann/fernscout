---
id: B1569
title: publish hardcodes nine journal profile keys, so ownerTel and travellers are dropped in silence
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, publish, config
found: "2026-09-12T08:21:10Z"
started: "2026-09-12T09:12:25Z"
session: 615a7d13-b735-48b0-a399-bf28e199b7bb
claimed: "2026-09-12T09:12:25Z"
---

# B1569 — publish hardcodes nine journal profile keys, so ownerTel and travellers are dropped in silence

## Why

`publish.mjs:293` picks the journal's own settings out of `config.json` with a
list written by hand:

```js
for (const key of ["title", "tagline", "visibility", "startLocation", "units",
                   "locales", "defaultLocale", "displayCurrencies", "manualRates"]) {
```

`JOURNAL_PROFILE_FIELDS` (`lib/journals.ts:894`) has eleven entries. The two
missing ones are `ownerTel`, added by B614 — the number the owner's own
WhatsApp copy of a day is sent to — and `travellers`, added by B1526 — the
journal's own default walking party. Both are writable through
`PATCH /api/v1/<user>/config`, both can sit in a local `config.json`, and
neither is ever sent. The run reports success, because every call it made did
succeed.

This is exactly the drift B1518 fixed one level down, for `trip.md`: a
hardcoded key list in `publish.mjs` falling behind the instance, twice
(`teaser`, then `cover`). The fix there was `shared/tripFields.mjs`, one list
imported by both `publish` and `validate-content`. The same answer applies here
and there is no second idea worth having.

## Work

`shared/journalFields.mjs`, mirroring `shared/tripFields.mjs`:
`JOURNAL_UPDATE_DOORS` (the eleven) and `JOURNAL_NO_UPDATE_DOOR`
(`owner`, `baseCurrency`, `media` — refused on purpose, so never warned about
as a gap). `publish.mjs` imports it instead of the hand-written list, and
`validate-content` warns when `content-model.json` knows a key the list does
not, the way it already does for trips.

**Being fixed inside B1504**, because that ticket has to replace this same
line: it needs the no-door half of that list to know what to say about
`owner.email`, `baseCurrency` and `media`. Captured separately so the second
bug is recorded as its own fact rather than absorbed into the first one's
title.

## Acceptance

- A local `config.json` carrying `ownerTel` or `travellers` reaches the site on
  a `publish` run, and the run names them among the fields it set.
- Adding a twelfth field to `JOURNAL_PROFILE_FIELDS` upstream makes
  `validate-content` say the helper's list is behind, rather than the field
  going missing in silence.
