---
id: B1496
title: A trip's translations can be set once and never corrected
type: ISSUE
priority: low
complexity: low
area: trips, api
found: "2026-09-11T17:40:00Z"
started: "2026-09-11T18:09:27Z"
merged: "2026-09-11T18:24:44Z"
completed: "2026-09-11T19:13:44Z"
---

# B1496 — A trip's translations can be set once and never corrected

## Why

Found while researching B1495. B245 closed the "trip.md cannot be changed"
family, and `PATCH /api/v1/<user>/trips/<trip>` (`lib/api/tripDetails.ts`) now
carries `title`, `tagline`, `start`, `end`, `cover`, `accent`,
`costsVisibility` and `intro`. `translations` is the one field of the eleven
`POST .../trips` accepts that still has no way back: it is writable at create
(`translationsBlock`, `lib/tripWrite.ts:632`), readable afterwards
(`app/api/v1/[user]/trips/[trip]/route.ts:54`, B540), and correctable nowhere.

A typo in a trip's German title is therefore permanent over the API, which is
the exact shape B245 existed to end — and it matters more than most, because
whoever reads that title is reading it in their own language and cannot see
the English one to know it is wrong.

It also blocks B1495's up leg from being a faithful mirror: a `translations:`
block edited in a local `trip.md` cannot reach the site.

## Validity, 2026-09-11

**Valid.** Read before taking it, and the ticket is exact.
`translationsBlock` (`lib/tripWrite.ts:632`) is called only from the blocks
list inside `createTrip` (`lib/tripWrite.ts:943`) and is not exported;
`app/api/v1/[user]/trips/[trip]/route.ts:54` reads the block back;
`patchTripDetails` (`lib/api/tripDetails.ts`) handles eight fields and
`translations` is not among them, and the route's own `FIELDS` list (line 239)
did not name it either, so the call answered `nothing_to_change` before it ever
reached the writer.

## Decided while building

- **`null` and `{}` both clear the block**, the `null`/`""` convention
  `tagline`, `cover` and `accent` follow one field-shape up. It needed no code:
  `translationsBlock` already answers both with no lines, and an emptied key is
  removed rather than written as a `translations:` holding nothing.
- **It replaces rather than merges.** Sending `{"de": …}` leaves a trip with
  German and nothing else. That is what `PATCH .../days/<slug>` already does
  with a day's `translations`, and it is the "send what it should be" rule
  every other field on this route follows.
- **Validation is `translationsBlock` imported, not re-checked.** The ticket
  said reuse the serialiser; reusing the *validator* is the same argument and
  is what makes the acceptance line about create and patch agreeing provable
  rather than merely tested. The test pins the two messages equal, not merely
  both-400.
- **`spliceBlock` rather than a fourth private copy.** `lib/frontmatterScalar.ts`
  now exports both shapes over one implementation — `spliceScalar` is a
  two-line wrapper — because `tripDetails.ts` already imports that module for
  its scalars. `lib/api/tripRates.ts` and `lib/api/costs.ts` keep their own
  copies, untouched: their comments make the call that a dozen lines beside the
  file they edit beats an import, and that is not this ticket's argument to
  reopen.
- **`app/api/trip/route.ts` is deliberately left alone.** That is the browser
  form's own door and carries the original four fields only; the ticket is
  about the API.

## Work

Add `translations` to `patchTripDetails` — the same door, not a new route,
for the same reason `cover` went there. It is a block rather than a line, so
it splices like `translationsBlock` already does on create; reuse that
function rather than writing a second serialiser. Decide whether an empty
object clears the block (the `null`/`""` convention the other optional fields
use) and document the answer.

`lib/api/openapi.ts` gets the field on the PATCH schema.

## Acceptance

- A trip created with a typoed German title can be corrected through
  `PATCH /api/v1/<user>/trips/<trip>` and read back through the same route's
  `GET`.
- An invalid block is refused with `invalid_translations`, the same error
  create gives.
- A locale the journal does not declare is handled the same way create handles
  it, with a test pinning that the two agree.
- `npm run verify` green; the field is in the PATCH schema in `/openapi.json`.

## Evidence, 2026-09-11

`npm run verify` green (534 files, 6986 tests, knip clean). Eight new tests in
`test/trip-details.test.ts`, including the one the last acceptance line asks
for: it asserts the PATCH and the `createTrip` refusals are equal *sentences*,
not merely both 400.

Driven against a running instance on content that existed before the branch —
`content/example/trips/alps-2024`, whose `trip.md` has carried a German and a
Hungarian title since long before this ticket. Run captured at
`/private/tmp/…/scratchpad/B1496-acceptance.txt`:

- `GET` reads the block; `PATCH` writes the typo `Alpn` onto disk (the state
  the ticket says was permanent), and a second `PATCH` corrects it back to
  `Alpen`, read back through the same route's `GET`.
- `fr` is refused on `PATCH` and on `POST .../trips` with the **same
  sentence**, printed side by side in the capture.
- `{"translations": "de"}` is refused `invalid_translations`.
- `git diff --stat` on that `trip.md` afterwards is empty: three writes, and
  the prose, the key order, `rates:`, `travellers:` and everything else came
  back byte for byte.

Seen, not only asserted: with the German title set to "Vier Tage rund um die
Alpen (korrigiert)", `/example/trips` under an `fs.locale=de` cookie renders
the corrected title on the trip card —
`/private/tmp/…/scratchpad/b1496/example-trips-1280.png` and its `.json`
(status 200, 0 console errors, 0 failed requests). The content file was
restored afterwards.
