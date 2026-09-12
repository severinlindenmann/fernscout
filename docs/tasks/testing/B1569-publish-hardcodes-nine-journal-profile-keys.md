---
id: B1569
title: publish hardcodes nine journal profile keys, so ownerTel and travellers are dropped in silence
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, publish, config
found: "2026-09-12T08:21:10Z"
started: "2026-09-12T09:12:25Z"
merged: "2026-09-12T09:18:02Z"
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


## Built, 2026-09-12

The send half landed inside B1504 — `publish.mjs` sends
`JOURNAL_UPDATE_DOORS`'s eleven keys, so `ownerTel` and `travellers` reach the
site. This run built the half that keeps it honest, and widened it:

- **`shared/dayFields.mjs`** — the day's keys, which were a hand-written list
  inside `publish.mjs`'s entry loop with nothing checking it. The least
  protected of the six such lists and the one a new field is most likely to
  land in.
- **`shared/doors.mjs`** — `unaccountedKeys()`, asked once. It replaces three
  copies of the same loop, B1518's trip version included.
- **`validate-content`** warns per file when `content-model.json` knows a key
  neither list accounts for.
- **`shared/doors.test.mjs`** — seven tests, because a guard nothing tests is
  decoration.

**Its first run found six false alarms**, all `apiOnly` keys — `username`,
`ownerName`, `ownerNickname`, `coordinates`, `photos`, `idempotency_key`,
`dryRun`. Those never appear in a file at all, so nothing on disk could have
failed to be sent; the guard now skips them and a test pins that. A guard that
fires on an honest run is a bug, and this one did before it was looked at.

**And three genuine ones**, captured as **B1578** rather than absorbed:
`timezone`, `weatherData` and a day's `visibility` are all in
`EDITABLE_DAY_FIELDS` (`lib/api/entries.ts:980`) and `publish` has never sent
any of them. `weatherData` is the one that matters — it is the sanctioned route
for a reading a person handed over, and it was being dropped in silence.

**What this does not do**, and the reason it is a fallback rather than a fix:
it can only notice after the instance has already grown the field. The gate
belongs where the field is added, in this repository — **B1577**, captured
with its design and the owner's decision on the document shape.
