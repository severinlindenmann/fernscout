---
id: B618
title: model.mjs carries an onlyWhen function nothing reads
type: CHORE
priority: low
complexity: low
area: fernscout-helper, model.mjs
found: "2026-09-06T15:41:06Z"
started: "2026-09-06T18:00:12Z"
merged: "2026-09-06T18:12:35Z"
completed: "2026-09-07T13:12:30Z"
---

# B618 — model.mjs carries an onlyWhen function nothing reads

## Why

Noticed while building B609.

`MODEL["plan.md"].onlyWhen` in `fernscout-helper`'s `shared/model.mjs` is a
function value. Nothing reads it: `validate.mjs` hand-writes the condition it
describes inline, at roughly line 327 — *a plan is only tipped for a trip whose
`status` is `upcoming`*.

Two copies of one rule, one of them dead, is the small version of what W41 is
about. It also cannot survive the direction that plan takes: a function does
not travel in JSON, so `content-model.json` expresses the same idea as a
`named` check (`plan-only-for-upcoming-trips`, declared by B608) and the
function has no future.

## Work

- Delete `onlyWhen` from `model.mjs`.
- Leave the inline condition in `validate.mjs` where it is, unless B610 has
  already moved it onto the named check — in which case say so and delete both.

## Acceptance

- `onlyWhen` appears nowhere in the repository.
- A trip with `status: upcoming` and no `plan.md` still gets the tip; one with
  any other status still does not.
- `selftest.mjs` passes.
