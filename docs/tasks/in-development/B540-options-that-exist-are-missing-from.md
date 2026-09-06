---
id: B540
title: Options that exist are missing from the schema the instance publishes
type: ISSUE
priority: medium
complexity: low
area: api, openapi, docs
found: "2026-09-06T14:05:00Z"
started: "2026-09-06T08:32:32Z"
session: 73b1a7f5-30ec-425d-9dbf-4d423e411c0d
claimed: "2026-09-06T08:32:32Z"
---

# B540 — Options that exist are missing from the schema the instance publishes

## Why

Found by pointing a schema-driven validator at a real journal
(`fernscout-helper`, the `validate-content` skill): it compares what a folder
carries against `/openapi.json` and reports drift in both directions. Six
fields the software accepts are absent from the document that says what it
accepts.

`POST /api/v1/{user}/trips`:

- **`costsVisibility`** — `public` | `guests`, `lib/tripWrite.ts:83`. B178
  exists *because* an owner could not reach this feature without an agent, and
  the agent's only machine-readable field list does not mention it.
- **`travellers`** — how the party is drawn, `lib/tripWrite.ts`.
- **`tracks`** — B531's, and the one a caller most needs to know about, since
  it decides what every subsequent day is refused for.

`POST /api/v1/{user}/trips/{trip}/days`:

- **`countryCode`** — `Entry.countryCode` in `lib/types.ts:155`, draws the
  flag. Not in the `Draft` schema.
- **`translations`** — in the schema for the day *edit* but not the day
  *create*, so the field an agent must send when a journal declares two
  locales is documented on the wrong call.

`PATCH /api/v1/{user}/config`:

- **`travellers`** — the journal's default party.

This is the same failure as B535, one level up. B535 stops a field being
silently dropped *on the way in*. This is a field being silently absent from
what an agent is told it may send — and the answer an agent gives to "what can
I set?" is exactly this document. A journal written against it comes out
missing options nobody knew existed, which is the complaint that started
B535/B536/B537.

Related but separate: **B536** is seven routes absent from the document
entirely. This is fields missing from routes that *are* documented, which is
worse in one way — the route looks covered.

## Work

- Add the six fields, with the descriptions the codebase already carries in
  its doc comments (`lib/tripWrite.ts` is unusually good on `costsVisibility`
  and `listed`).
- `lib/api/openapi.ts` opens with "there are five endpoints"; it documents
  around thirty. Fix the sentence while there.
- A test that the `Draft` schema's properties are a superset of the day fields
  `validateEntry` knows, and that `POST …/trips`'s are a superset of
  `NewTrip`'s keys. Hand-written schemas drift; the point of B535 is that this
  document is now load-bearing, so it needs the same ratchet
  `test/api-route-schemas.test.ts` gives the route list.

## Acceptance

- All six fields appear in `/openapi.json`, with a description.
- The new test fails when a field is added to `NewTrip` or `EntryInput` and not
  to the document.
- `node validate.mjs --user <someone>` in fernscout-helper reports no
  "this instance does not list it" warnings for a valid journal.
- `npm run verify` green.
