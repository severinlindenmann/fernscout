---
id: B607
title: A config PATCH reports credits as off on a server that has it on
type: ISSUE
priority: low
complexity: low
area: api, config
found: "2026-09-06T15:13:00Z"
started: "2026-09-06T15:13:16Z"
merged: "2026-09-06T15:23:17Z"
---

# B607 — A config PATCH reports credits as off on a server that has it on

## Why

B408 is this bug, fixed once and in one direction. `view()` in
app/api/v1/[user]/config/route.ts:80 special-cases the two capabilities that
are never a journal's own opt-in:

```ts
features[name] =
  name === "logging" || name === "credits"
    ? serverOnly[name].enabled
    : user.features[name].enabled;
```

`setJournalFeatures` in lib/journals.ts:665 builds the same map for the PATCH
response and has no such case — it reads `now.features[name].enabled`, the raw
per-journal flag, for every name including those two. So `GET` and `PATCH` on
one URL disagree about one journal in the same second. Observed on
fernscout.ch while switching analytics on for `severin`:

```
PATCH /api/v1/severin/config  → "credits": false
GET   /api/v1/severin/config  → "credits": true
GET   /api/health             → "credits": {"enabled": true}
GET   /api/v1/severin/status  → "credits": {"enabled": true}
```

Three routes say the capability is on and the fourth says it is off, and the
fourth is the one an agent has just been handed as the result of its own write.
What it costs: an agent that reads the PATCH response — the natural thing to
do, since it is the state after the change — concludes credits are off and
tells the owner sends cannot be paid for. `logging` is wrong the same way and
happens to read `false` on both paths today, so nothing shows it.

## Work

- One function building that map, used by the GET, the PATCH and anything else
  that answers with a journal's features. The special case exists because
  `logging` and `credits` are the operator's rather than the journal's; it
  belongs beside the fact, not copied into each reader.
- `lib/config.ts` already knows which capabilities those are — the same skip
  appears in `DEFAULT_FEATURES` and in app/api/health/route.ts. Export the list
  rather than writing `name === "logging" || name === "credits"` a fourth time.

## Acceptance

`GET` and `PATCH /api/v1/<user>/config` return the same `features` object for a
journal nothing has changed in between, with `credits` and `logging` reading
the server's answer on both. A test that enables `credits` at the server level,
PATCHes an unrelated capability, and asserts the response says `credits: true`
— it fails now.

## Built

The Why was accurate as written; confirmed both call sites and the exact line
numbers before changing anything.

- `lib/config.ts` now exports `OPERATOR_ONLY_FEATURES = ["logging", "credits"]
  as const satisfies readonly FeatureName[]`, beside `FEATURE_NAMES`.
- `lib/journals.ts` gets one new exported function, `journalFeatures(user:
  UserConfig)`, that builds the map with the `OPERATOR_ONLY_FEATURES` skip. It
  is the single builder the ticket asked for. `setJournalFeatures`'s PATCH
  response now calls it instead of looping over `now.features[name].enabled`
  directly (the exact bug).
- `app/api/v1/[user]/config/route.ts`'s `view()` (the GET) now calls the same
  `journalFeatures()` instead of duplicating the loop — so GET and PATCH share
  one implementation rather than two copies that can drift again.
- `app/api/health/route.ts`'s own skip (`name === "logging" || name ===
  "credits"`) is now `(OPERATOR_ONLY_FEATURES as readonly
  string[]).includes(name)` — the fourth copy the ticket named, now reading
  the exported list.
- `lib/api/status.ts` was already correct (B397 fixed `credits` there
  specifically) and uses a different feature subset (`AGENT_FEATURES`) with a
  richer per-feature shape (`{enabled, reason}`), so it was left alone rather
  than folded into `journalFeatures()` — that would have been a second,
  unrelated reshape.
- `lib/api/openapi.ts`: added one clause to the PATCH request schema's
  `features` description noting that `logging` and `credits` echo the
  server's own answer regardless of what is sent, since that is now
  observably true of the response and wasn't documented either way before.

Test: `test/journal-features.test.ts`, new case "B607: PATCHing an unrelated
capability still reports credits from the server" in the existing `describe("B408
— config agrees with status and health about server-only capabilities")`
block. Confirmed it fails before the fix (reverted `setJournalFeatures`'s
return to the old raw loop, ran `npx vitest run test/journal-features.test.ts`
— 1 failed: `expected false to be true`) and passes after (restored the fix,
34→35 passed).

`npm run verify` passed in full: build, `tsc --noEmit`, eslint (only
pre-existing unrelated warnings), and all 292 test files / 3782 tests.
