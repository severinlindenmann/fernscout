---
id: B314
title: A comment beside the trip route still says a new trip defaults to private
type: CHORE
priority: low
complexity: low
area: api, comments
found: "2026-09-04T16:29:20Z"
---

# B314 — A comment beside the trip route still says a new trip defaults to private

## Why

Found while building B307. `app/api/v1/[user]/trips/route.ts:64-65` reads:

> What protects them here is the visibility default, which is `private` unless
> the caller says otherwise

B306 changed that hours earlier. A new trip now inherits **the journal's own
visibility** — `guest` for a guest journal, `public` for a public one — and
`private` is only the fallback for a value this code cannot recognise. The code
two lines below the comment is correct; the comment is not.

Small, and worth doing rather than leaving, for the reason this repository
keeps its comments long in the first place: it explains *what protects* a
reader, which is exactly the kind of sentence somebody trusts instead of
re-reading the code. A wrong comment about a safety property is worse than no
comment, and this one sits in the file an agent-facing route change would open
next.

## Work

Correct the comment to what B306 built: the default follows the journal's own
`visibility`, an explicit value on the call wins, and an unrecognised value
falls back to `private` — the strictest state, which is the property the
comment was reaching for and can still claim.

While there, grep for other comments naming the old default. B306 updated
AGENTS.md and the generated documents; the ones inside route and lib files were
not part of its diff, and if this one survived there may be others.

## Acceptance

No comment in the repository claims a new trip is private by default, and the
one at `app/api/v1/[user]/trips/route.ts` describes what the code beneath it
actually does.
