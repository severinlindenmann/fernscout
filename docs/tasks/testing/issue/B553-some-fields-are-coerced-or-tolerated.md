---
id: B553
title: Some fields are coerced or tolerated where every sibling field is refused
type: ISSUE
priority: medium
complexity: low
area: api, validation
found: "2026-09-06T16:20:00Z"
started: "2026-09-06T10:32:24Z"
merged: "2026-09-06T10:48:04Z"
---

# B553 — Some fields are coerced or tolerated where every sibling field is refused

## Why

Found while making the published contract executable (B540). Each of these is
small; together they are the reason a caller cannot trust "it was accepted" to
mean "it was understood". The document now names the enum in every case, which
makes the mismatch worse rather than better: it says *one of these two* and the
server takes anything.

- **`units` on `POST /api/v1/journals`** is documented `metric | imperial`, and
  the handler checks only for the literal `"imperial"` — everything else,
  including a typo, silently becomes `metric`
  (`app/api/v1/journals/route.ts:282`). Every sibling enum on that route
  (`visibility`, `defaultLocale`) is refused rather than defaulted.
- **`days` on `POST …/invites`** is documented `integer` and checked only with
  `Number.isFinite`, so `2.5` is accepted
  (`app/api/v1/[user]/invites/route.ts:212`).
- **`people[]` tolerates unknown keys and drops them**
  (`lib/tripWrite.ts`), while `travellers[]` — the block right beside it —
  refuses them with `invalid_travellers`. Same call, two answers to the same
  mistake.
- **`location`, `country`, `transportFrom`, `transportTo` on a day are not
  type-checked at all.** They are in `DraftInput` and not in `EntryInput`, so a
  number reaches `quoteScalar` and throws, which surfaces as a 500 where every
  other bad field is a 400 naming itself.
- **`/api/auth/identity/request` answers `502` for a mail failure** where its
  two structurally identical siblings answer `503`.

## Work

Refuse rather than coerce, in each case, with the message shape the
neighbouring field already uses. `units` is the one with a compatibility
question worth a moment's thought — an instance that has been sending
`"Metric"` would start getting a 400 — but silently writing the opposite of
what somebody asked for is the worse outcome, and B535's `checkBody` will
refuse unknown *fields* on these routes soon anyway.

Not doing: `travelScene`, which is deliberately read back as the default
rather than refused and says so in the document.

## Built

All five, each with a test that failed first:

- `units` on `POST /api/v1/journals` refuses anything that is not `metric` or
  `imperial`, instead of silently making a typo `metric`.
- `days` on an invite must be a whole number.
- `people[]` refuses an unknown key by name, the way `travellers[]` beside it
  always has. `PEOPLE_FIELDS` is `name`, `email`, `nickname`; `peopleBlock` was
  confirmed to be the only writer.
- `location`, `country`, `transportFrom` and `transportTo` are type-checked.
  They were in `DraftInput` and not in `EntryInput`, so a number reached
  `quoteScalar`, which throws — a 500 where every other bad field is a 400
  naming itself, and a 500 tells an agent to report a bug rather than fix its
  body.
- `/api/auth/identity/request` answers `503` for a mail failure, like its two
  siblings, rather than `502`.

## Acceptance

- `units: "Metric"` is refused, not silently made metric.
- `days: 2.5` on an invite is refused.
- An unknown key inside a `people[]` entry is refused, the way `travellers[]`
  already does.
- `location: 12` on a day is a 400 naming `location`, not a 500.
- `npm run verify` green.
