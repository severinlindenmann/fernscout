---
id: B1745
title: Buying extra storage is only offered once the journal is nearly full
type: FEATURE
priority: low
complexity: low
area: account page
found: "2026-09-14T17:57:17Z"
merged: "2026-09-14T18:02:07Z"
completed: "2026-09-15T08:19:33Z"
---

# B1745 — Buying extra storage is only offered once the journal is nearly full

## Why

The owner asked to be able to buy storage before running out. B1270 gated the
offer on `percent >= 90` so a journal holding a kilobyte would not be sold 5 GB;
the effect is that somebody who knows a large import is coming cannot buy room
ahead of it. The purchase route itself never had the gate — only the page did.

## Work

Drop the `percent >= 90` condition from `canBuy` in `app/[user]/account/page.tsx`.

## Acceptance

`/<user>/account` shows the buy-storage button whenever credits are enabled,
regardless of how full the journal is.
