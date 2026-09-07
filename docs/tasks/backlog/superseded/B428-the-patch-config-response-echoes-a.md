---
id: B428
title: The PATCH config response echoes a stale features block that a GET moments later contradicts
type: ISSUE
priority: low
complexity: low
area: api
superseded: "fixed by B607 — journalFeatures(now) is re-read after the write"
found: "2026-09-05T09:37:24Z"
---

# B428 — The PATCH config response echoes a stale features block that a GET moments later contradicts

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Triage 2026-09-07

Checked against current code during the backlog cleanup: lib/journals.ts now returns
`journalFeatures(now)` computed after the write, so the PATCH response no longer echoes a
stale features block. B607 landed it (commit 8e6fa835) and sits in testing/.
