---
id: B397
title: health and status report credits off per-journal though it is server-only and live
type: ISSUE
priority: medium
complexity: low
area: credits, api, capabilities
found: "2026-09-05T01:20:00Z"
started: "2026-09-04T22:56:07Z"
merged: "2026-09-04T23:12:41Z"
---

# B397 — health and status report credits off per-journal though it is server-only and live

## Why

Found by the credit-system pen test (authorized, against the live instance). Not
exploitable — no balance moves, no send goes free, no other journal's data
leaks — but a self-contradictory report an owner and an agent both rely on.

`credits` is a **server-only** capability: `creditsEnabled()` in
`lib/credits.ts` calls `isEnabled("credits")` with no username, on purpose, so a
journal can neither opt in to nor out of being billed. But two reporters resolve
it *with* a username through `resolveCapabilities(user)`, which narrows every
capability a journal's own config has not explicitly set to `true` — and no
journal sets `credits: true`, because it is not theirs to set:

- `app/api/health/route.ts:199` skips `logging` from the per-journal narrowing
  block for exactly this reason ("no per-journal opt-in — B257") and never added
  `credits`, which has the identical property. So `/api/health` lists, for a
  live-billed journal, `credits: { enabled: false, reason: "not enabled by
  <user>" }`.
- `lib/api/status.ts:131` builds its `features` block for `AGENT_FEATURES`
  (which now includes `credits`, B366) from `resolved[name]` — the
  username-narrowed answer — so `GET /api/v1/<user>/status` returns
  `features.credits: { enabled: false }` right beside a non-null
  `credits.balance`. An agent reading that cannot tell billing is on, which is
  the whole reason the balance was added to status.

Confirmed live: `GET /api/health` returns `journals.example.credits.enabled:
false` while `capabilities.credits.enabled: true` at server level and example
holds 200 credits.

## Work

- `app/api/health/route.ts` — add `credits` to the `logging` skip:
  `if (name === "logging" || name === "credits") continue;`, and extend the
  comment to say credits is server-only for the same reason (the money is the
  operator's card, not the journal's — the argument already in `lib/credits.ts`
  and `lib/config.ts`).
- `lib/api/status.ts` — report `credits` in the `features` map from the
  server-level `creditsEnabled()` (no username), not from
  `resolveCapabilities(user)[name]`. The simplest shape: drop `credits` from
  `AGENT_FEATURES` (it is not a per-journal opt-in like the other four) and add
  it to the `features` object explicitly as `{ enabled: creditsEnabled() }`,
  next to where `creditBalance` is already resolved. The `credits.balance`
  block that follows is unchanged.
- Check no other caller of `resolveCapabilities(username)` treats `credits` as
  a per-journal opt-in — `grep -rn "resolveCapabilities(" lib app`.

## Acceptance

- `npm run verify` green.
- A test (extend `test/capabilities.test.ts` or a health/status test): with
  server `credits` on and a journal that never mentions credits in its config,
  `/api/health` does **not** list `credits` under that journal's narrowed
  block, and `journalStatus` reports `features.credits.enabled: true` with a
  non-null `credits.balance`.
- By hand against the live instance after deploy: `GET /api/health` no longer
  shows `credits` narrowed for `example`.
