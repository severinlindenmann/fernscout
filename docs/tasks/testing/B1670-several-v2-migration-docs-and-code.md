---
id: B1670
title: Several v2-migration docs and code comments describe a pre-migration state that no longer exists
type: DOCS
priority: medium
complexity: low
area: api-v2
found: "2026-09-13T13:56:25Z"
merged: "2026-09-13T19:50:30Z"
---

# B1670 — Several v2-migration docs and code comments describe a pre-migration state that no longer exists

## Why

Reviewing the finished v2 migration against `docs/v2-migration/*.md` and the
running code turned up four places where a document (or a code comment,
which AGENTS.md treats the same way — a claim somebody will read and trust)
still describes an earlier state:

1. **D20 in `docs/v2-migration/06-contract-deltas.md`** ("A known gap this
   does not close") says `app/[user]/media/[...path]/route.ts`'s `labelOf`
   "reads a trip's photographs by scanning v1 markdown entries... it has no
   knowledge of a v2 JSON day's own `media` array at all yet", so a
   `visibility: private` photo attached via the v2 media-attach route is
   served to anyone who can read the trip. This was true when D20 was
   written but is false today: `lib/entries.ts`'s `readAllEntries`
   (lines ~286-382) now reads `.json` day files directly and
   `labelOf` goes through that same function, so it enforces v2 media
   visibility correctly. `test/entry-visibility.test.ts` (47 passing tests)
   confirms this, and a prior reviewer's wont-do ticket B1662 already found
   the same thing and closed it — but D20 itself was never corrected or
   cross-referenced, so it currently reads as an open, live gap and invites
   the next reader to re-litigate a closed question.
2. **The same section's "Not a contract change" note** says `incomplete` and
   `stale_document` are "not yet" in `ERROR_CODES`, with `V2_ONLY_CODES` in
   `lib/api/v2/route.ts` as the open IOU, "emptied" when the first route
   ships answering them. `V2_ONLY_CODES` is already `[] as const`
   (`lib/api/v2/route.ts:19`), both codes are defined in
   `lib/api/errorCodes.ts`, and many routes already return them. By the
   ledger's own stated rule this IOU should already read as paid.
3. **`lib/api/v2/schemas/day.ts:3`** still says "Storage stays markdown;
   this is the wire shape only" — false since the JSON-storage decision
   (`06-contract-deltas.md`'s final section, B1606).
4. **`lib/api/v2/store.ts:5-9`** says `lib/trips.ts`/`lib/entries.ts`
   "read `trip.md` and `entries/*.md` via gray-matter" and that teaching
   them to read JSON "is a separate, tracked piece of work" — also false:
   both now read the `.json` files directly (`lib/trips.ts:641-646`,
   `lib/entries.ts:294,306`), per B1598, which `docs/v2-migration/05-status.md`
   already records as shipped.

None of these are functional bugs — the running code in every case is
correct and matches the newer, accurate record (05-status.md, B1662,
test suites). The risk is purely a reader's: a ticket, an agent, or a person
trusting one of these four passages will chase a problem that was already
fixed, or reopen a decision that already stands.

## Work

Update the four passages named above to describe the current state, or add
an explicit superseded/correction note pointing at the ticket/status entry
that overtook them (the way `06-contract-deltas.md` already does for other
renumbered/corrected entries). No code changes.

## Acceptance

D20, the error-codes IOU note, `day.ts:3` and `store.ts:5-9` each either
describe the current behaviour or explicitly say what superseded them.
