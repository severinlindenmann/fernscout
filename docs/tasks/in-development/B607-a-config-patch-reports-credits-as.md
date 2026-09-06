---
id: B607
title: A config PATCH reports credits as off on a server that has it on
type: ISSUE
priority: low
complexity: low
area: api, config
found: "2026-09-06T15:13:00Z"
started: "2026-09-06T15:13:16Z"
session: 302202e0-2cc6-4652-a548-b27b8ba57337
claimed: "2026-09-06T15:13:16Z"
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
