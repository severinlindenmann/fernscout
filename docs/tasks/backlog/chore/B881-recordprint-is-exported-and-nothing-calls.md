---
id: B881
title: recordPrint is exported and nothing calls it, so knip fails on main
type: CHORE
priority: low
complexity: low
area: photobook
found: "2026-09-07T17:51:59Z"
---

# B881 — recordPrint is exported and nothing calls it, so knip fails on main

## Why

`npm run unused` fails on `main` as of commit cf4cac61 ("Photobook: print
state on the order that was built"): `recordPrint` at
`lib/photobook/orders.ts:356` is exported and has no caller anywhere in
`lib/`, `app/`, `scripts/` or `test/`. That means every branch cut from main
fails `verify` at its last step for a reason that is not its own — found
while merging B878.

## Work

Either wire it to whatever was meant to call it (the Gelato print flow), or
drop the `export` keyword if it is used only within its own file, or delete
it. Whoever is on the Gelato work knows which.

## Acceptance

`npm run unused` is clean on `main`.
