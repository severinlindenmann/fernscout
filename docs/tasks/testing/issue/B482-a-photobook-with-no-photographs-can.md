---
id: B482
title: A photobook with no photographs can still be paid for from a stale tab
type: ISSUE
priority: medium
complexity: low
area: photobook, credits
found: "2026-09-05T15:17:19Z"
started: "2026-09-06T14:20:13Z"
merged: "2026-09-06T14:34:11Z"
---

# B482 — A photobook with no photographs can still be paid for from a stale tab

## Why

B476 refuses a photograph-less book at preview time: `POST
/<user>/photobook/preview` answers `buyable: book.photoCount > 0` and the page
disables Pay with `photobook.noPhotos`. The design spec's error table asks for
exactly that — "Refused at preview time, so Pay is never enabled against a book
that cannot be bound."

The order route has no matching guard, and the claim that no UI path can submit
one is not quite true. Preview a book while the trip has photographs, remove the
photographs (another tab, an agent, a file deleted on disk), then press Pay: the
route re-plans with `planFor`, gets `photoCount === 0`, and charges ~90 credits
for a padded text-only book.

Not a security hole — the owner presses Pay themselves and does receive real
files. It is their own money spent on a book the product says it will not sell.

## Work

Add the guard to `app/[user]/photobook/order/route.ts`, where `planFor`'s
result is already in hand for the price. It is **not** the one line it looks
like: `back_("no_photos")` also needs an entry in `OUTCOME_MESSAGE` in
`PhotobookPageContent.tsx`, which `photobook.noPhotos` currently lacks because
that key is used for the disabled-Pay hint rather than as an outcome banner.

Decide while you are there whether the same staleness affects the price: the
book is re-planned at Pay, so a trip that changed since the preview can be
charged at a figure the owner never saw.

**Not doing:** removing the preview-time refusal. Both belong — one explains,
one enforces.

## Acceptance

- Excluding every photograph, or emptying the trip after previewing, and then
  posting the order form charges nothing and returns a message that says why.
- The message is a real outcome banner, not a silent no-op.

## Done

Guard added in `app/[user]/photobook/order/route.ts`, right after `planFor`'s
result is in hand and before `claimOrder` runs: `if (book.photoCount === 0)
return back_("no_photos");`. Nothing is claimed, built or spent for that
request — `claimOrder`/`buildPhotobook`/`spend` never run.

`no_photos: "photobook.noPhotos"` added to `OUTCOME_MESSAGE` in
`PhotobookPageContent.tsx`, reusing the existing disabled-Pay-hint string as
the ticket suggested — it already says the right thing ("A book needs at
least one photograph…").

Both `back()`'s and `back_()`'s `state` parameter are now typed
`PhotobookOutcomeState` (a new export from `lib/photobook/orders.ts`, shared
with B484's fix) rather than `string`, so this and any future `back_(...)`
call is checked against the same union the page's message table is checked
against.

Evidence:
- `test/photobook-order-route.test.ts` — "a book with no photographs charges
  nothing, even from a stale tab": `photoCount: 0`, asserts
  `state=no_photos` in the redirect, and that `claimOrder`, `buildPhotobook`
  and `spend` were never called. Fails on `main` (route posts through to
  `claimOrder`/`buildPhotobook`/`spend` and redirects `state=done`), passes
  after.
- `npm run verify` — full run, green: build, tsc, eslint (0 errors, 12
  pre-existing unrelated warnings), vitest (285 files / 3686 passed / 3
  skipped for Postgres).

**Decided, on the price-staleness question the Work section asked about:**
the same window is real for price, not just for photo count — the book is
re-planned at Pay from current disk state, and the owner only ever saw the
price the last preview quoted. Fixing it (carrying the previewed price
forward and re-confirming, or building from the exact plan the preview
produced instead of asking `planFor` again) is a larger, separate design
decision than this ticket's guard, so it is **not** built here — captured
instead as B595 rather than absorbed into this diff, per this repo's own
rule about a second problem found while building one.
