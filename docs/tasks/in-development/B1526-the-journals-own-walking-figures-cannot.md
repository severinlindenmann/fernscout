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
