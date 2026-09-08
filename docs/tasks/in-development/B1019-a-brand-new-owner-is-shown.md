---
id: B1019
title: A brand new owner is shown a signup form for the journal they already have
type: ISSUE
priority: high
complexity: low
area: helper, routing
found: "2026-09-08T19:34:42Z"
started: "2026-09-08T19:36:31Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T19:36:31Z"
---

# B1019 — A brand new owner is shown a signup form for the journal they already have

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`journalsFor()` drops a journal with no trips (`lib/home.ts`, `if
(trips.length === 0) continue;`), and `/agent` decides who is signed in from
that list. So a brand new owner — signed in, journal created, identity
resolved — gets an empty list, falls through to the door, and is shown
**"New here? Start your own journal"**, with their own email already in the
form, for the journal they have just made.

The `empty` opening exists precisely for this person: *"Willkommen. Hier ist
noch keine Reise — erzähl mir von deiner, dann lege ich sie an."* It is the
one state written to reassure somebody who has just arrived, and it is the one
state they can never see.

Verified live on a fresh journal immediately after signup.

The function is not wrong for its own purpose — a journal with no trips has
nothing to *read*, and `journalsFor` was written for the landing page's list of
things to read. It is the wrong question for "whose journals are these".

## Work

`/agent` asks who owns what, not what there is to read. Either a second
function that answers that, or a flag on this one — and then look for other
callers making the same mistake, because "journals with something in them" and
"journals this person owns" have been the same list until somebody had neither.

## Acceptance

A journal created a minute ago, with no trip in it, opens the room on its empty
state. A test that creates a journal, adds no trip, and asserts what /agent
renders.
