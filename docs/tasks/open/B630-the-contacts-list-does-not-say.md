---
id: B630
title: The contacts list does not say whether a person is owner, buddy or guest
type: FEATURE
priority: medium
complexity: low
area: contacts page
found: "2026-09-06T17:51:44Z"
---

# B630 — The contacts list does not say whether a person is owner, buddy or guest

## Why

`/<user>/contacts` lists people with different relationships to the journal —
the owner, buddies on a trip, guests of the journal — and the row does not say
which. The distinction matters at exactly the moment the owner is on that page:
a buddy can write to a trip, a guest can only read, and telling them apart from
a name and an address is guesswork.

## Work

- A short tag on each row: owner, buddy, guest. Buddy is per trip, so say which
  trip, or say how many.
- Read the relationship from what already decides it — `peopleOf()` for a
  buddy, the grant for a guest, `owner.email` for the owner — rather than
  storing a new field.
- A person can be more than one thing. Say so rather than picking a winner.

## Acceptance

- Each row on `/<user>/contacts` carries its relationship, and it matches what
  the gates actually allow.
