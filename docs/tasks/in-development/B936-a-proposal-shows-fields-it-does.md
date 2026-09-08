---
id: B936
title: A proposal shows fields it does not carry
type: ISSUE
priority: high
complexity: low
area: agent
found: "2026-09-08T09:12:38Z"
started: "2026-09-08T09:12:40Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T09:12:40Z"
---

# B936 — A proposal shows fields it does not carry

## Why

`start_day`'s proposal shows `costs` and `coordinates` as fields defaulting to
"nobody has said" — B917's fix, and the person can see and change them — but
those values are **not in `arguments`**. Pressing the proposal as `arguments`
describes it returns `incomplete_day`.

Same defect as B935 and worth its own line because the remedy differs: here the
fields are *right* and the arguments are *incomplete*, so either the defaults
belong in `arguments` too, or a field the call needs must not be shown as
though it were already answered.

Found on the live instance, 2026-09-08, by pressing a proposal the way its own
data says to.

## Work

Fold a field's default into `arguments` when it is produced, so the two never
describe different calls. Then the test in B935 covers this case as well.

## Acceptance

A proposal's fields and its arguments always describe the same call.
