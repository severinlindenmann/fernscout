---
id: B1504
title: An up leg reports success on config fields that can never reach the site
type: ISSUE
priority: low
complexity: low
area: helper, api, config
found: "2026-09-11T18:32:07Z"
started: "2026-09-12T08:20:20Z"
session: 615a7d13-b735-48b0-a399-bf28e199b7bb
claimed: "2026-09-12T08:20:20Z"
---

# B1504 — An up leg reports success on config fields that can never reach the site

## Why

Found while researching B1495. Three fields of `content/<user>/config.json`
have no write door and are refused on purpose, each with its reasoning written
beside it at `app/api/v1/[user]/config/route.ts:219`: `owner.email` is the auth
boundary itself, `baseCurrency` would silently misconvert every cost already
recorded, and `media` is a ceiling a journal must not be able to widen for
itself. All three refusals are right and none of them should change.

The problem is what a client does with them. B1495's up leg pushes a local
folder to the site; a person who corrects one of those three lines in their own
`config.json` and runs a sync gets a run that reports success, because every
call the run made did succeed. The line simply never reaches the site, and
nothing says so.

That is the shape AGENTS.md keeps coming back to: *"It was accepted" is not the
same claim as "it is there"*, and a person reading the run's output has no
other way to know. The same argument the helper's own stale-trip-field warning
was built on — `publish.mjs:395-418` already does exactly this for trip fields.

## Work

The up leg compares those three fields against what the instance reports and
prints a named warning per field that differs, rather than passing over them in
silence. Reuse the machinery `publish.mjs` already has for the trip-field
staleness check rather than writing a second one.

Mostly a `fernscout-helper` change. If `GET .../config` does not read back
enough to make the comparison, that part is here.

## Acceptance

- Editing `owner.email`, `baseCurrency` or `media` locally and running the up
  leg prints a warning naming the field and saying it cannot be sent, and the
  run does not report those fields as applied.
- Editing a field that *does* have a door still reaches the site with no
  warning — a guard that fires on an honest run is a bug.
