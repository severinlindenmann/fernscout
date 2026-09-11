---
id: B1526
title: The journal's own walking figures cannot be set at all over the API
type: ISSUE
priority: medium
complexity: low
area: api, travellers
found: "2026-09-11T20:30:00Z"
started: "2026-09-11T20:56:33Z"
session: bfe90fb0-0095-4532-8af8-601ad489b14c
claimed: "2026-09-11T20:56:33Z"
---

# B1526 — The journal's own walking figures cannot be set at all over the API

## Why

Asked by an owner on 2026-09-11: *"why does my mainpage not show the figure?"*

Because there is no way to put one there. `agent.md` says

> Every journal opens with figures walking, and this is who they are

and `validate-content` tips `travellers` on `config.json` as

> how the walking figures are drawn when a trip does not say. **There is no API
> call for the journal's default party — it is read from this file**

That is true for a self-hosted instance pointed at a `CONTENT_DIR`. On
`fernscout.ch` the journal has no file anybody can edit: `config.json` reaches
the server through `PATCH /api/v1/{user}/config`, and that route takes

```
features · title · tagline · visibility · startLocation · units ·
locales · defaultLocale · displayCurrencies · ownerTel · manualRates
```

— no `travellers`. The only figure routes that exist are per trip
(`…/trips/{trip}/travellers`), plus `presets` and `preview`.

So a hosted journal's landing page can never have figures, and nothing says so.
The owner had figures on the trip (set, verified, drawn) and an empty landing
page, with no way to tell the two levels apart. The tip actively misleads here:
it names a file that, on this deployment, the owner cannot write.

## Work

- Accept `travellers` on `PATCH /api/v1/{user}/config`, validated against the
  same vocabulary and `maxFigures` as the trip route. It is the same shape and
  the same check; this is plumbing.
- Or, if the journal default is meant to be file-only by design, say that in
  `agent.md` and in the tip — *"on a hosted journal this is set per trip; the
  landing page uses the most recent trip's party"* or whatever the intended
  behaviour is. Silence is the thing to fix either way.

While in there: `GET /api/v1/{user}/travellers` (no trip) does not exist, so a
caller cannot read the default party either — only guess that there is none.

## Acceptance

- A hosted journal can set the figures its landing page walks, or the docs say
  plainly that it cannot and why.
- `validate-content`'s tip for `config.json`'s `travellers` does not point at a
  file the owner has no way to write.

## Done

Took the first option: `PATCH /api/v1/{user}/config` now accepts `travellers`
(`lib/journals.ts`), validated by the exact `travellersBlock` function
`.../trips/{trip}/travellers` already uses, so a figure refused on one route
is refused on the other in the same words — verified in
`test/journal-features.test.ts`'s new "an unknown figure field is refused by
name, the same message the trip route gives". An empty list clears the
default (removes the key, same convention as `tagline`), and a `changed`
count no longer misfires on clearing an already-empty default (the old
`before[field] !== ""` check assumed every clearable field was a string;
fixed with a per-field `EMPTY` map).

Added `GET /api/v1/{user}/travellers` (`app/api/v1/[user]/travellers/route.ts`)
mirroring `.../trips/{trip}/travellers`'s `GET` — owner-only, the same gate
`GET .../config` uses, since a trip-scoped token may change its own trip's
party but not the journal's default (tested: a trip-scoped token gets `403`
from both the read and the write).

Both routes are in `lib/api/openapi.ts` — the `PATCH …/config` schema gained
a `travellers` property (`$ref: Traveller`, same as the trip route), and
`/api/v1/{user}/travellers` is a new path — plus `lib/api/documentation.ts`'s
`/documentation.txt` guide, which named the field and pointed at both new
calls.

Fixed the stale tip in this repo: `lib/contentModel/document.ts`'s
`config.json` rule for `travellers` was `fileOnly: true` with hand-written
prose saying "There is no API call for the journal's default party — it is
read from this file". Removed `fileOnly` now that there is a real API door;
`fernscout-helper`'s tip-builder is documented (in the comment this replaced)
to borrow a description from `openapi.json` for any non-`fileOnly` key, so it
now picks up the `PATCH …/config` schema's own `travellers` description
instead. This part of the fix could only be made here — nothing under
`fernscout-helper` was reachable from this checkout.

Verified: `npx vitest run test/journal-features.test.ts test/content-model.test.ts
test/openapi-contract.test.ts test/api-route-schemas.test.ts` — 124 tests,
all pass.

Also verified as part of the combined full `npm run verify` for all three
tickets in this worktree (see B1519's "Done" section for the run): all 5
stages passed, 539 files / 7058 tests, nothing here regressed anything
outside this ticket's own files.
