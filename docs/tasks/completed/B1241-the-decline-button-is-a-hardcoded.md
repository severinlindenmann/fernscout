---
id: B1241
title: The decline button is a hardcoded English No
type: ISSUE
priority: high
complexity: medium
area: whatsapp, helper, ux
found: "2026-09-10T08:48:06Z"
merged: "2026-09-10T09:20:04Z"
completed: "2026-09-10T15:12:36Z"
---

# B1241 — The decline button is a hardcoded English No

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The confirm decline button is the literal string "No" on a German
conversation (lib/whatsapp/render.ts builds it hardcoded). The accept side is
already the proposal's own language.

## Work

A locale string (wa.declineButton: Nein / No / Nem) rendered per the
journal's locale, threaded to where confirmButtonsFor builds the pair. Do not
hide the decline — a confirm with no way out is not a confirm.

## Acceptance

A German journal's confirm shows "Nein"; existing press/decline tests updated.
