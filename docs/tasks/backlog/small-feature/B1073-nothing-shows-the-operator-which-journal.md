---
id: B1073
title: Nothing shows the operator which journal names are held in reserve
type: FEATURE
priority: low
complexity: low
area: admin, tombstones
found: "2026-09-09T10:49:16Z"
---

# B1073 — Nothing shows the operator which journal names are held in reserve

## Why

`content/.deleted/<username>.json` keeps a deleted journal's name reserved so
its old URLs answer 410 rather than becoming somebody else's pages
(`lib/tombstones.ts`). An operator frees a name by deleting the file — which
means knowing the file is there, over SSH, in a directory nothing lists.

`/admin` (B746) is the page that exists to tell the operator what their
instance is doing, and it does not mention this. So the reserved-name list is
real state with real consequences — a signup refused with `username_taken`
for a journal nobody can see — and the only way to read it is a shell.

It matters slightly more from 2026-09-09, since the decision on B1064 is that
deleting a journal **frees its owner's address and telephone number** while
the *name* stays held. Two halves that behave differently need somewhere a
person can see which is which.

## Work

- A section on `/admin` listing tombstoned names: the name, when it was
  deleted, and nothing else. It is a name and a date, not a person.
- Whether the page can free one is a decision. Reading it is the whole of the
  problem today; a button that permanently un-reserves URLs is a second,
  larger question and can be a follow-up.
- `/admin` reads a cookie and asks `resolveIdentity`, never a bearer token —
  the existing gate, unchanged.

Not doing: exposing this anywhere but `/admin`, or making tombstones expire.

## Acceptance

The operator can see every held name and its date without opening a shell.
