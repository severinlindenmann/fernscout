---
id: B907
title: Most of what a trip says about itself can be written once and never corrected
type: ISSUE
priority: medium
complexity: low
area: api, trips
found: "2026-09-08T04:57:40Z"
started: "2026-09-08T19:51:08Z"
merged: "2026-09-08T20:18:57Z"
completed: "2026-09-09T16:46:14Z"
---

# B907 — Most of what a trip says about itself can be written once and never corrected

## Why

`POST /api/v1/<user>/trips` accepts seventeen fields.

**Re-validated 2026-09-08 before building anything**, by reading both routes
as they stood on `main`: `PATCH /api/v1/<user>/trips/<trip>`
(`app/api/v1/[user]/trips/[trip]/route.ts`) and
`PATCH /api/v1/<user>/trips/<trip>/visibility`
(`app/api/v1/[user]/trips/[trip]/visibility/route.ts`, added by B396/B587,
after this ticket's own text was written). The gap was **not** what the
original text said:

| Field | Correctable before this ticket? |
| --- | --- |
| `title`, `tagline`, `start`, `end` | Yes — `PATCH .../trips/{trip}` (B621/B622) |
| `cover` | Yes — same route (B245) |
| `visibility` | Yes — `PATCH .../trips/{trip}/visibility` (B396), **already** enforcing "unrecognised reads as private" |
| `listed` | Yes — same route (B396/B51), **already** refusing `listed: true` on a trip nothing advertises |
| `teaser` | Yes — same route (B587), **already** refusing `teaser: true` on a public trip |
| `intro` | **No** — confirmed the real gap |
| `accent` | **No** — confirmed a real gap (cosmetic, safe to close) |
| `costsVisibility` | **No** — confirmed a real gap (safe to close: an unrecognised value is refused, never defaulted, same as `createTrip`) |
| `status` | No, and deliberately left so — see Work |
| `test` | No, and deliberately left so — see Work |

So three of the seven fields the ticket named (`listed`, `teaser`, and
`visibility` itself, which the ticket's prose didn't even list but the same
`PATCH` also carries) were fixed by B396/B587 in between this ticket being
captured and picked up — including the exact rule this ticket worried about
losing (`listed: true` refused and logged, B51). The ticket was **partially
stale**: real, but for `intro`, `accent` and `costsVisibility` only.

So a typo in a trip's introduction was permanent unless somebody had a shell
on the server. This is the same class as B220 and the same class as the
currency in B839: create validates and accepts, correct cannot reach.

Found by mapping every operation to a chat shape, 2026-09-08.

## Work

Widened `PATCH /api/v1/<user>/trips/<trip>` (and the shared
`patchTripDetails` in `lib/api/tripDetails.ts` it and the browser's
`/api/trip` both call) to also accept:

- **`intro`** — the trip's own prose. Not a frontmatter scalar, so it needed
  a second splice function (`spliceIntro`, local to `tripDetails.ts`) that
  replaces everything after the closing `---` while a scalar splice still
  handles every frontmatter key named in the same call. Any string is
  accepted, including empty.
- **`accent`** — checked against the same `ACCENTS` enum `createTrip` checks
  the first value against; `null`/`""` clears it, matching `tagline`/`cover`.
- **`costsVisibility`** — checked against `COSTS_VISIBILITIES`; an
  unrecognised value is **refused, never defaulted** (the same rule
  `createTrip` follows, because either fallback would be a silent decision
  about somebody's money); `null`/`""` clears it back to the default,
  `public`.

Each new error code (`invalid_accent`, `invalid_intro`; `invalid_costs_visibility`
already existed) was added to `lib/api/errorCodes.ts`, and the request schema
in `lib/api/openapi.ts` for this operation now lists all eight fields with the
two enums imported from `lib/tripWrite.ts` (`ACCENTS`, `COSTS_VISIBILITIES`),
never typed out.

**Deliberately still not on `PATCH`, decided rather than merely deferred:**

- **`visibility`, `listed`, `teaser`** — already correctable through
  `PATCH .../trips/{trip}/visibility`, which enforces the three rules this
  ticket was worried about (unrecognised visibility → private; `listed: true`
  refused where nothing advertises the trip; `teaser: true` refused on a
  public trip). Adding a second acceptance path on this route would be a
  second, driftable copy of those rules — the opposite of AGENTS.md's "an
  enum is imported, never typed out" applied one level up. Left alone.
- **`status`** — `upcoming`/`current`/`past` is derived from the calendar at
  almost every reading path (`effectiveStatus`, `lib/tripTime.ts`); the file's
  own value only matters when it says `current`, the one state the calendar
  cannot settle on its own. Correcting it well is its own decision the way a
  day's `status` has its own route (B905) rather than a slot on this generic
  PATCH — left for that ticket.
- **`test`** — flips whether a trip is content nobody lived. Turning it on
  for a trip that has already published real days (or off for one built as a
  test fixture with days already on the site) is a bigger, different
  decision than fixing a typo, and nothing today decides what should happen
  to what is already live. Left file-only until somebody decides that.

## Acceptance

- **A trip's intro can be corrected over the API** — `test/trip-details.test.ts`,
  describe block `"B907's three fields: accent, costsVisibility, intro"`,
  test `"a trip's intro can be corrected over the API — the ticket's own
  acceptance line"`: `PATCH /api/v1/<user>/trips/<trip>` with `{"intro": "…"}`
  returns `200` with the new `intro`, `GET` reads it back, and every
  frontmatter key survives byte for byte.
- **Each field that still cannot be says why, in the document** — this file
  (Work, above), the docblock on `PATCH` in
  `app/api/v1/[user]/trips/[trip]/route.ts`, the docblock above
  `patchTripDetails` in `lib/api/tripDetails.ts`, and the operation
  description in `lib/api/openapi.ts` all carry the same three reasons
  (visibility/listed/teaser have their own door; status wants B905; test is a
  bigger decision on a trip with real days) — one reasoning, stated in the
  places an agent or the next person would actually be reading.

Verified with `npm run verify` (full build → tsc → eslint → vitest → knip),
green: 443 test files, 5755 tests passed, 4 skipped (pre-existing, unrelated).
