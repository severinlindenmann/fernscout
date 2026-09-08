---
id: B985
title: Only two of the write routes record a press they refused
type: CHORE
priority: low
complexity: low
area: helper, sessions
found: "2026-09-08T16:24:40Z"
started: "2026-09-08T16:54:03Z"
merged: "2026-09-08T17:29:00Z"
---

# B985 — Only two of the write routes record a press they refused

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B976 records a press through `wrote()` when it succeeds — one place, every
route — and through `refused()` when it does not, which is per-route and is
wired into two: `POST .../trip` and `POST .../day/costs`.

Those two are where a proposal a press cannot accept has actually reached a
live instance (B935's trip id, B968's `Food`), so the data starts where the
evidence is. The rest — `day`, `day/publish`, `day/unpublish`, `day/attach`,
`day/write-day`, `invite` — refuse without leaving a row, so their acceptance
rate reads as "proposed and abandoned" when it was really "pressed and
refused". Those are different failures and the table cannot tell them apart.

Small and mechanical, and deliberately left until the data says it is worth
having: the turn's own `proposed` already shows a proposal nobody pressed,
which is the signal that matters most.

## Work

`refused(user, tool, error)` at each write route's refusals — the ones after
the ownership and capability gates, since an auth failure is not a press
failing on its content.

## Acceptance

Every helper write route that can refuse a well-formed press leaves a row
saying which refusal it was.
