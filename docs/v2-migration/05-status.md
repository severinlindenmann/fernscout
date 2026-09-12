# Status log — keep this true

Update after EVERY step: what happened, commit ids, live-validation
evidence (commands + observed output), tickets filed, what is next. The
next session starts by reading this file.

## 2026-09-12 — handoff written (session ending here)

- Phase 0 DONE: golden contract on branch b1587-api-v2-schemas —
  lib/api/v2/schemas/* frozen, 30 tests green, V/T verdicts folded
  (dayPatch/tripPatch, cover-not-at-create, translations.intro,
  checkPatchConflicts). openapi.json + area contracts + challenges + ticket
  scan in docs/plans/2026-09-12-api-v2/.
- Phase 1 DONE: fernscout.ch locked — signup disabled + ALPHA banner
  (EN/DE) in /var/lib/fernscout/config.json (backup:
  config.json.pre-alpha-20260912). Verified: /api/health status ok with
  off including signup; POST /api/auth/signup/request ->
  {"error":"signup_disabled"}; banner renders on the landing page.
- B1587 is the umbrella ticket (in-development; move to testing when this
  branch merges). B1592 captured (units field inert). B1588 superseded
  (duplicate capture).
- NEXT: phase 2 step 1 (v2 plumbing) per 03-build-order.md.

## 2026-09-12 — phase 2 step 1: v2 plumbing (B1596)

**The decision that reshaped this step.** The owner lifted the constraint
this plan was written under: **breaking changes to the on-disk file format
are allowed**, because only `content/example/` has to be converted and that
happens in the phase-3 replay. So the serializer is not a mapping layer
between two vocabularies — **a day's frontmatter IS `dayDoc`**, minus the
two fields that live elsewhere (`slug` is the filename, `content` is the
body), plus what the server derives. One fact, one address, and the address
is the one the wire already uses.

What the file shape becomes:

| | was (v1) | is (v2-canonical) |
|---|---|---|
| day position | `lat:` / `lng:` | `coordinates: {lat, lng}` |
| day photographs | `gallery:` | `media:` |
| day draft state | `draft: true` | `status: "draft" \| "published"` |
| day weather | `weather: true` + `weatherData:` | one `weather:` key — the server's own reading is simply one whose `source` is `open-meteo` |
| day declines | `without:` / `unrecorded:` / `costs: false` | `declined: {}` |
| trip dates | `start:` / `end:` | `dates: {from, to}` |
| trip figures | `travellers:` | `figures:` |
| trip costs visibility | `costsVisibility:` in `trip.md` | `visibility:` in `costs.md` |
| trip rates | flat `rates: {EUR: 0.94}` | `rates: {currencies, manual}` |

`trip.md`, `costs.md` and `plan.md` stay three files. Not for compatibility
— each has a real prose body, and this is a folder a person owns and reads.
The wire document unifies them; splitting them is the serializer's job.

**Built** (branch `b1596-v2-plumbing`):

- `lib/api/v2/route.ts` — the one error envelope (`fail`/`ok`), `etagFor`
  and `ifMatchStale` (V11: absent `If-Match` is never stale, last-write-wins
  is the documented default; a stale write answers 409 with the current
  document), `readDryRun` (T1 — a **query parameter**, because every v2 write
  body is a `strictObject` and would refuse an unknown key, and a flag that
  decides whether bytes are written is not part of the document being
  written; renamed from `isDryRun` — B1601 — because a `boolean` return could
  not say "the caller sent something this cannot read", and that case has to
  refuse rather than guess in either direction), `readJson`, `logV2Request`.
- `V2_ONLY_CODES = ["incomplete", "stale_document"]` — the contract's IOU.
  Both are deliberately NOT in `lib/api/errorCodes.ts` yet:
  `test/openapi-contract.test.ts` fails on a code no route answers. **The
  build step that ships the first route answering them adds them there and
  empties this list** (step 3). A test asserts the invariant both ways.
- `lib/api/v2/incomplete.ts` — `incompleteFrom` / `problemsFrom` /
  `splitIssues`. The 422 `missing[]` rows carry `to_provide` **generated**
  from the section's own Zod schema (`z.toJSONSchema`), never prose typed
  beside it. A body that is both incomplete and wrong reports both halves.
- `lib/api/v2/markdown.ts` — the pure md↔document serializer, v2-canonical,
  whole-file. Emission goes through gray-matter's `stringify` (js-yaml
  under it) rather than hand-built YAML lines: B204's two private copies of
  the same wrong escaping are exactly what this avoids having a third of.
  Round-trip losslessness is the test.
- `formatV2RequestLine` in `lib/requestLog.ts` — per-call, metadata only,
  never a body, never a query string, never an IP.
- `describeScope()` and `Session.expiresAt` in `lib/auth/index.ts`, parsing
  the trip scope by asking `tripWriteScope()` for its own prefix rather
  than writing the string a third time.
- `test/api-v2-imports.test.ts` — the import boundary. A v2 file may import
  nothing from `app/`, and nothing from `lib/api/` outside an explicit
  allowlist (seeded with `lib/api/errorCodes` alone). It proves itself
  against known-bad specifiers first, so the currently-empty `app/api/v2/`
  walk cannot be mistaken for a passing rule.
- `lib/api/errorCodes.ts` is now `as const satisfies Record<string, string>`
  rather than annotated. The annotation widened `keyof typeof ERROR_CODES`
  to `string`, so `fail("invalid_reqest", …)` would have compiled and
  answered with a word no document defines — B540 one level up.

**Two safety calls made in the plumbing**, both the same asymmetry the trip
gate already has (an unrecognised visibility reads as private, never
public):

- An unrecognised or missing `status:` on disk reads as **draft**, never as
  published. A file this serializer cannot read confidently must not become
  a published page.
- `describeScope` answers the wider of its two frozen enum values when a
  scope is unrecognised, rather than inventing a third.

**Tickets filed this step:**

- **B1597 — `tripDoc.costs` had no home for `costs.md`'s preparation cost
  lines or its prose.** FIXED in this same merge (the owner unblocked the
  contract change): `costs` widened to `{budget, items, note, visibility}`,
  `items` reusing the day's own `costItem` shape, imported rather than
  retyped.
- **B1598 — v2-canonical files are unreadable by `lib/entries.ts` and
  `lib/trips.ts`, and the render layer has no step in the build order.**
  This is the consequence of the breaking-change decision and it is not
  small: the day a v2 file is written is the day it renders as an empty,
  positionless day. Must land as ONE merge with the conversion of
  `content/example/`, or immediately after the phase-3 replay — readers and
  content have to flip together. **Insert it into `03-build-order.md` at
  step 3.** B1599 is the same capture filed twice, marked superseded.

**Decided on the example conversion** (owner, this session): no hand-rewrite
first. Dry-run the serializer over the current `example` as soon as it
lands — read with the v1 readers, map, serialise, report everything the
golden contract cannot carry, write nothing. The real conversion rides
B1598's merge; phase 3's replay through the live HTTP API stays the
acceptance test, because that is what proves the API rather than the files.

**Still open, cheap to answer later:** v1's `people[]` entries carry a
`nickname` that the frozen v2 `person` schema has no field for; v1's trip
`reminder`/`reminderChannel` likewise. Both currently die in the
serializer. Neither blocks.

**Live validation:** none — nothing public was built. Per 03-build-order
this step deploys anyway to keep the loop honest.

**NEXT: phase 2 step 2 (auth + the DB drop).** The build spec is
reconnoitred. **Read this before deploying it:** M1 drops the database, and
the drop is NOT recoverable by people signing in again for — `credits`,
`credit_ledger`, `payments` (balances and the whole audit trail an operator
reconciles a card statement against), `contacts` (postal addresses and
explicit postcard/digest consent), `access_grants` + `trip_people` (every
grant must be re-approved by hand), `usage` (paid-provider billing
history), `reactions` (reader-authored content), `tracking_points`. Only
`example` is replayed. **The owner must see that list and say yes before
the drop**, and should take an out-of-band backup first.
