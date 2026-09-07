---
id: B710
title: The reverse geocoding URL is guessed from the forward one
type: ISSUE
priority: low
complexity: low
area: addressLookup
found: "2026-09-07T11:17:13Z"
started: "2026-09-07T11:40:37Z"
merged: "2026-09-07T12:17:54Z"
completed: "2026-09-07T13:14:13Z"
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

## Resolution

`lib/addressLookup.ts` — `providerConfig()` now reads `reverseUrl` from
`features.addressLookup` alongside `url`. Absent (the default, and every
config written before this ticket), it falls back to the same guess as
before (`url` with a trailing `/api/` replaced by `/reverse`), now named
`derivedReverseUrl()` — nothing existing changes. `reversePlace()` uses
`providerConfig().reverseUrl` instead of deriving it inline.

`/api/health` now names the reverse URL in use: `lib/capabilities.ts`'s
`resolveOne` attaches a `note` to the `addressLookup` capability (alongside
the existing `dryRunNote` mechanism postcards/photobook already use) reading
`reverse lookups are sent to <url>` — visible whenever the capability is on,
whether the URL is the guess or an operator's own `reverseUrl`. This exports
`addressLookupEndpoints()` from `lib/addressLookup.ts` for that purpose.

One narrowing of the acceptance line: this ticket implements the
configuration escape hatch and the visibility into which URL is active — it
does **not** add a live health probe that calls the provider and checks
whether it "answers." `reversePlace()` already fails safe (never throws,
`null` on any failure) and that behaviour is unchanged; an operator who wants
to know the provider is *actually* reachable still has to try a lookup. Adding
an active check felt like a second, separable feature (it would need its own
timeout/retry/caching story to avoid `/api/health` making a network call on
every hit) rather than part of "say which URL is guessed" — flagged here
rather than silently narrowed.

Test: `test/address-lookup.test.ts` — new `describe("reverseUrl", …)` block:
default guess unchanged, an instance can point `reverseUrl` at a different
path, and `reversePlace` fetches the configured `reverseUrl` rather than a
derived one. Confirmed all three fail before the fix and pass after.
