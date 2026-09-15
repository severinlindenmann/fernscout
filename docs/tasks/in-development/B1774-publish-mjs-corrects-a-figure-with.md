---
id: B1774
title: publish.mjs corrects a figure with PATCH and the route has none, so every run after the first exits non-zero
type: ISSUE
priority: high
complexity: low
area: fernscout-helper publish, app/api/v2/[user]/figures/[id]
found: "2026-09-15T06:24:42Z"
started: "2026-09-15T06:39:54Z"
session: 135632db-3afb-4bd0-bf02-4ee0fb20ab0d
claimed: "2026-09-15T06:39:54Z"
---

# B1774 — publish.mjs corrects a figure with PATCH and the route has none, so every run after the first exits non-zero

## Why

`publish.mjs`'s `send()` is one helper for trips and figures: `GET` the
address, then `PATCH` with `If-Match` if something is already there. There is
no `PATCH` on a figure. `app/api/v2/[user]/figures/[id]/route.ts` exports
`GET`, `PUT` and `DELETE` only, and its `PUT` is the documented door for a
correction — a `PUT` carrying `If-Match` is how a caller says "I have read this
and mean to replace it".

So the first run creates the figures and every run after it gets 405 for each
one. Because a refusal increments `refused` and the script exits 1, a whole
per-trip invocation then reports failure regardless of what else it did: in one
run five trips were reported FAILED whose trips and days had all been written
perfectly. A real failure and this noise are indistinguishable from the exit
code.

## Work

Send a figure the way its route documents: `PUT` with `If-Match` when it
already exists. And skip it entirely when the stored document already equals
the local one — `sendJournal()` already does that comparison for `config.json`
and it is the same argument, a run should not write on every pass just to print
a line.

Worth deciding at the same time whether the instance should grow a figure
`PATCH` for symmetry with trips and days; that is the larger change and this
ticket does not need it.

## Acceptance

`publish` run twice over a journal with figures exits 0 both times and says the
figures were unchanged on the second pass.
