---
id: B1643
title: content/example is not v2-canonical and demonstrates only part of the contract
type: CHORE
priority: high
complexity: high
area: content/example
found: "2026-09-13T06:26:46Z"
merged: "2026-09-13T08:01:18Z"
---

# B1643 — content/example is not v2-canonical and demonstrates only part of the contract

## Why

`content/example` is still entirely v1: 59 markdown files, `trip.md` +
`costs.md` + `plan.md` per trip, `lat`/`lng` instead of `coordinates`,
`gallery` instead of `media`, `travellers:` blocks instead of the figures
library, `start`/`end` instead of `dates`. v2's readers read v2 JSON only
(no dual-shape reader, B1598), so the demo journal — the one journal the
migration must bring back (M2) — does not load.

Second, and the reason this is not just a format conversion: **the example
is the acceptance fixture** (M3). It has to demonstrate every option the
contract allows, or a feature has no proof it works end to end and no
example for an agent to copy. Today it exercises perhaps half: no video, no
per-photo visibility, no `weatherData` reading of somebody's own, no
`teaser` trip, no `guest`/`private` trip, no `test: true` content, one
figures mode of three, no declined sections at all (the whole
asked-or-declined mechanism is undemonstrated), no statement/manual rate.

Third, nothing checks either property. A field added to the schemas tomorrow
has nothing failing to say the example never shows it.

## Work

- A converter (`scripts/example-to-v2.mts`) reading v1 content and writing
  v2 JSON **through the real serializers** (`dayToJson`/`tripToJson`), so
  the output cannot drift from the format the server reads. It prints a
  migration report — every field mapped, dropped or declined — per
  04-instruments.
- The retired encodings map rather than vanish: `costs: false` -> `costs: []`
  (nothing spent is an answer, not a decline), `costs: "unknown"` ->
  `declined.costs`, `tracks:` -> declines, `travellers:` -> figure documents
  + a `figures` reference, `rates: {EUR: 0.94}` -> `rates.manual`.
- Enrich to full coverage: every field of every schema demonstrated at least
  once, every small enum exhausted, both weather routes, all three trip
  visibilities, every decline.
- `test/example-content.test.ts`: every file parses and validates against
  the schemas, AND a coverage assertion that fails when a schema field or
  enum value is demonstrated nowhere.

Not doing: replaying through the live HTTP API. The routes are still being
built; the converter writes canonical files through the same serializer the
routes use, and phase 3's live replay can re-run against the result.

## State (2026-09-13)

**Done, on branch `b1643-example`, not merged.** The conversion, the
enrichment and `test/example-content.test.ts` (28 tests) are green in
isolation; `test/api-v2-schemas.test.ts` (36) still passes beside them.
B1645 was found by the first run and fixed here (delta D11).

**Blocked on B1598.** With this content on `main`, 11 tests in 6 files fail
— every one because the v1 readers still filter `.md`
(`lib/entries.ts:263`). Four of those files land with B1598 itself
(`currency`, `generator-output`, `story-jump-label`, `depersonalised`).

**One open decision, the owner's:** the two remaining files are the v1 demo
seeder (`scripts/build-demo-content.mjs`, `npm run demo:build`), which
writes markdown a v2 instance cannot read. Retire it — the example is
committed, so a fresh clone already has the demo, and B556 already made the
script refuse to touch an existing journal — or port it to v2 JSON.

## Acceptance

- `content/example` contains no `.md` under `trips/`; every file parses with
  `dayFromJson`/`tripFromJson` and validates against the schemas.
- `test/example-content.test.ts` passes, and fails if a schema field is
  added that the example does not demonstrate.
- The migration report is committed beside the content so the transformations
  are reviewable.




