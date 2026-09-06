---
id: B540
title: Options that exist are missing from the schema the instance publishes
type: ISSUE
priority: medium
complexity: low
area: api, openapi, docs
found: "2026-09-06T14:05:00Z"
started: "2026-09-06T08:32:32Z"
merged: "2026-09-06T10:17:16Z"
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

## What it turned out to be

The capture said "six fields missing from the document". Two of the six were
not documentation at all, and the rest was larger. Corrected as built:

**`PATCH …/config` does not accept `travellers`.** The capture was wrong.
`JOURNAL_PROFILE_FIELDS` (lib/journals.ts) has no such case and the route
answers `400 unsupported_field`. The journal's default party is read from
`config.json` on disk and nothing writes it over the API. Documenting it would
have been documenting a capability that does not exist. A trip's own
`travellers:` is writable, at `POST …/trips` and `PATCH …/trips/<id>/travellers`.

**Two of them were code, not prose.** Found by driving a real journal onto a
running instance rather than by reading:

- `POST …/trips` forwarded every raw block field except `tracks`. `createTrip`
  had supported it since B531; the route never read `body.tracks`. A trip
  created with every track turned off came back tracking everything and
  refused its own first day.
- `POST …/days` accepted `countryCode`, answered 201 and threw it away. It
  looked like it worked wherever `country` was a name `lib/flags.ts` knows —
  the guess supplied the code — and failed silently everywhere else.

Both are the shape this repository keeps finding: not a refusal, a success
that quietly did less than it said.

**Two more, found the same way, after the first fixes:**

- `travellers` was documented as "an object". Its keys are `FIGURE_FIELDS`,
  and `for` is an **address out of `people:`**, not a name — which is the
  refusal that stopped the first complete publish run.
- `without` — B531's record of what a day deliberately has none of — was
  written into the file and never returned when reading a day back. An agent
  could not tell "there was no money on this day" from "nobody asked", and
  asking again is how an amount gets invented.

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

## Built

- Every enum in the document now comes from the constant the server validates
  against: `TRANSPORT_MODES`, `TRAVEL_SCENE_VARIANTS`, `COST_CATEGORIES`,
  `TRACKS`, `FEATURE_NAMES`, `ACCENTS`, `STATUSES`, `VISIBILITIES`,
  `COSTS_VISIBILITIES`, `FIGURE_FIELDS`. `ACCENTS`, `STATUSES`,
  `COSTS_VISIBILITIES` and `FIGURE_FIELDS` are exported for it.
- `Cost.category` said "free text" and is a closed list that refuses anything
  else.
- Fourteen route+verb pairs that existed and appeared nowhere are documented,
  including `travellers/presets` and `travellers/preview`, which `AGENTS.md`
  sends agents to by name.
- `/api/health` publishes the upload formats and the size limits, because a
  client needs them **before** it uploads and was otherwise forced to keep its
  own copy. The copy in `fernscout-helper` offered `jpg` and `avif`; this
  server takes neither.
- `test/openapi-contract.test.ts` is the ratchet: every bearer-token
  route+verb documented, every enum equal to its source, no operation without
  a refusal, no `required` naming a field that is not in `properties`. The
  browser-only flows and the two B293 signposts are a named allowlist rather
  than an omission.
- B536's list of routes with a body and no schema is now empty, and its test
  asserts it stays empty.

## Acceptance

- All six fields appear in `/openapi.json`, with a description.
- The new test fails when a field is added to `NewTrip` or `EntryInput` and not
  to the document.
- `node validate.mjs --user <someone>` in fernscout-helper reports no
  "this instance does not list it" warnings for a valid journal.
- `npm run verify` green.
