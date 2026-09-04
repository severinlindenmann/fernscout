---
id: B186
title: The trip gate's doc comment points at a route group that no longer exists
type: DOCS
priority: low
complexity: low
area: docs, trips, auth
found: "2026-09-03"
started: "2026-09-04T06:22:42Z"
merged: "2026-09-04T06:43:26Z"
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

## What was done

The comment now reads as a docblock for the function it actually sits on and
keeps the pointer:

```
/**
 * `noindex` for a trip that is not indexable, and nothing else.
 *
 * The gate itself is below. Its sibling is `app/[user]/(trip)/layout.tsx` —
 * the same gate, over the pages that render the *current* trip at the bare
 * `/<user>` URLs. The two have to be kept in step, so read one before
 * changing the other.
 */
```

It was doing double duty before: it is attached to `generateMetadata`, which
is not the gate, while describing the gate below it.

**The acceptance was too wide, and is narrowed below.** The grep now has a
second hit, `docs/plans/W19-presentation.md:60`, and that one is correct as it
stands. `docs/plans/INDEX.md` says plans are "kept as the record of intent and
are not updated to match what shipped, so a command or a path in one of them
may not be the form that exists today", and `test/docs-links.test.ts` excludes
`docs/plans/` from its link guard for exactly that reason. Editing W19 would
be rewriting a record of what somebody meant to build in 2026 to match what
exists now. Left alone deliberately.

## Acceptance

- `grep -rn 'app/(current)' app lib components test` returns nothing.
  (`docs/plans/` is excluded: it is a record of intent, never updated — see
  `docs/plans/INDEX.md` and the `RECORDS` list in `test/docs-links.test.ts`.)
- The comment names `app/[user]/(trip)/layout.tsx`.
