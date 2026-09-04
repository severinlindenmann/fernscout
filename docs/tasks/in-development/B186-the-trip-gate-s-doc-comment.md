---
id: B186
title: The trip gate's doc comment points at a route group that no longer exists
type: CHORE
priority: low
complexity: low
area: docs, trips, auth
found: "2026-09-03"
started: "2026-09-04T06:22:42Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:42Z"
---

# B186 — The trip gate's doc comment points at a route group that no longer exists

## Why

Noticed while working on B117. `app/[user]/trips/[trip]/layout.tsx:30` says:

```
/** See app/(current)/layout.tsx — the same gate, for trips at /trips/<id>. */
```

There is no `app/(current)/`. The sibling it means is `app/[user]/(trip)/`,
which the route group was renamed to when the gate was moved off the user
layout. It is one line and it costs a minute, but it is the kind of pointer an
agent follows before touching the gate — and the two gate layouts are exactly
the pair that has to be kept in step, so a reference between them that leads
nowhere is worse than none.

## Work

Correct the path in the comment. Check for other references to the old group
name at the same time — this was the only hit at the time of writing:

```bash
grep -rn 'app/(current)' app lib components test docs
```

## Acceptance

- `grep -rn 'app/(current)'` over the tree returns nothing.
- The comment names `app/[user]/(trip)/layout.tsx`.
