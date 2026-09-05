---
id: B482
title: A photobook with no photographs can still be paid for from a stale tab
type: ISSUE
priority: medium
complexity: low
area: photobook, credits
found: "2026-09-05T15:17:19Z"
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
