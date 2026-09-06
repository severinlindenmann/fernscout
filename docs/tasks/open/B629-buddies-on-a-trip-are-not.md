---
id: B629
title: Buddies on a trip are not offered in the postcard signature
type: ISSUE
priority: medium
complexity: low
area: postcards, buddies
found: "2026-09-06T17:51:44Z"
---

# B629 — Buddies on a trip are not offered in the postcard signature

## Why

The signature on a postcard back should be everybody who was on the trip. It is
built from the trip's hand-written `people:` block, but that has not been the
whole answer since B33: `peopleOf()` in `lib/trips.ts` merges the file's people
with the rows a buddy link created. So an owner who invited somebody by link
finds them missing from the signature, and has no way to add them.

## Work

- Read the trip's people through `peopleOf()` wherever the postcard back is
  composed, so an approved buddy is offered like anybody in `people:`.
- Offered, and still the owner's choice — the byline rule (credit is the file's
  statement) is about the *page*; a signature is who is signing this card.

## Acceptance

- A person who joined a trip through a buddy link appears among the people
  offerable in a postcard signature.
- A trip with no buddies signs exactly as it does now.
