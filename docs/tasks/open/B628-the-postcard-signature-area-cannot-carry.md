---
id: B628
title: The postcard signature area cannot carry the traveller figures
type: FEATURE
priority: medium
complexity: low
area: postcards, travellers
found: "2026-09-06T17:51:43Z"
---

# B628 — The postcard signature area cannot carry the traveller figures

## Why

A postcard's back has a signature area, and the journal already knows what the
travellers look like — the walking figures at
`/api/v1/<user>/travellers/preview`, drawn from the vocabulary in
`lib/photobook/travellers.ts`. They appear in a photobook and not on a
postcard, which is the wrong way round: a postcard is the smaller, more
personal object.

## Work

- Offer the traveller figures beside the signature on the postcard back, off by
  default and switched on per order.
- Use the existing figure rendering; do not draw a second set for print.
- Watch the safe area — `docs/branding/print` is the bench that shows it.

## Acceptance

- With the option on, the figures for the people on the trip print beside the
  signature and stay inside the safe area.
- With it off, the back is exactly as it is now.
