---
id: B710
title: The reverse geocoding URL is guessed from the forward one
type: ISSUE
priority: low
complexity: low
area: addressLookup
found: "2026-09-07T11:17:13Z"
---

# B710 — The reverse geocoding URL is guessed from the forward one

## Why

`lib/addressLookup.ts` gained `reversePlace()` in B682, and it derives the
provider's reverse endpoint by string-replacing a trailing `/api/` in the
configured forward URL. Photon happens to be shaped that way; nothing
guarantees another provider is, and `providerConfig()` validates nothing beyond
`new URL` not throwing.

The failure is silent by design — the module never throws and returns `null` —
so a misconfigured instance gets days with no place on them and no clue why.

## Work

A `reverseUrl` beside `url` in `features.addressLookup`, defaulting to the
derived value so nothing existing changes. Say in `/api/health` which one is in
use.

## Acceptance

An instance can point forward and reverse lookups at two different paths, and a
provider that answers neither says so in `/api/health` rather than silently
producing days with no location.
