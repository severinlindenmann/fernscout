---
id: B1819
title: An Android location export is accepted and imports nothing
type: ISSUE
priority: high
complexity: low
area: gps, import, importers
found: "2026-09-16T19:34:33Z"
---

# B1819 — An Android location export is accepted and imports nothing

## Why

Google moved Maps Timeline onto the phone during 2024. Android and iOS now
write different files with different shapes, and `importers/gps/google-timeline.ts`
reads only the iOS one.

Both shapes were fed to the importer on 16 September 2026:

```
iOS/documented         detect=true  fixes=1
Android Timeline.json  detect=true  fixes=0
```

The Android file **passes `detect()`** — it matches on `semanticSegments`, and
`parse()` unwraps the object root correctly — and then produces zero positions.
No error, no warning. The person waits, sees an empty map, and concludes the
feature is broken. It is.

A silent accept is worse than a rejection: a rejection tells somebody to try
something else.

Cause: `parseGeoUri()` at `importers/gps/schema.ts:48` requires a `geo:`
prefix. Android writes `"35.0116°, 135.7681°"`.

| | Android | iOS |
| --- | --- | --- |
| Filename | `Timeline.json` | `location-history.json` |
| Root | `{ "semanticSegments": [...] }` | `[...]` |
| Coordinates | `"45.4642°, 9.1900°"` | `"geo:45.4642,9.1900"` |
| Place id key | `placeId` | `placeID` |
| Numbers | numbers | strings |
| Visit location | nested under `latLng` | direct string |

This blocks B1824's location onboarding: writing step-by-step instructions that
send half the users to a file the importer silently discards makes the
experience worse, not better.

Background and sources: `docs/plans/2026-09-16-import-onboarding.md`.

## Work

Teach the importer the Android shape. The object wrapper is already handled, so
the work is in coordinate and field parsing:

- accept degree-sign coordinate pairs alongside `geo:` URIs
- accept `placeID` as well as `placeId`
- coerce string numbers
- accept `visit.topCandidate.placeLocation` as a direct string

Keep `importers/gps/google-records.ts` — people still hold pre-2024 Takeouts —
but note that Google Takeout no longer produces location history, so it must
never be offered as a path somebody can take today.

Not doing: the onboarding copy or the peek screen. Those are B1824.

Consider whether `detect()` succeeding while `parse()` returns nothing should
be an error in its own right, anywhere in the importer framework. A zero-fix
parse from a file we claimed to recognise is always a bug.

## Acceptance

- A real Android `Timeline.json` fixture parses to a non-zero, sane fix count.
- The existing iOS fixture still parses unchanged.
- A fixture that is detected but yields zero fixes fails loudly rather than
  importing silently.
- `npm run verify` passes.
