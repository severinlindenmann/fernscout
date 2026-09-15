---
id: B1774
title: publish.mjs corrects a figure with PATCH and the route has none, so every run after the first exits non-zero
type: ISSUE
priority: high
complexity: low
area: fernscout-helper publish, app/api/v2/[user]/figures/[id]
found: "2026-09-15T06:24:42Z"
started: "2026-09-15T06:39:54Z"
merged: "2026-09-15T07:09:14Z"
completed: "2026-09-15T08:19:26Z"
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

## Built, 2026-09-15 — fernscout-helper `aa69dbd`

**Valid when taken**: `send()` PATCHed anything that already existed, and
`app/api/v2/[user]/figures/[id]/route.ts` exports `GET`, `PUT` and `DELETE`
only.

`send()` takes `replace`, and the figure call site passes it: an existing
figure is `PUT` with `If-Match`, which is that route's documented correction
door. A figure the instance already holds unchanged is not written at all — the
run prints `unchanged` rather than claiming a correction, the same comparison
`sendJournal()` already did for `config.json`.

No instance change: `PUT` + `If-Match` is the contract, and adding a figure
`PATCH` for symmetry would be a second door for one fact.

Keeper: five checks in `publish.test.mjs`, whose fake instance now answers 405
to a `PATCH` on a figure exactly as the real route does.
