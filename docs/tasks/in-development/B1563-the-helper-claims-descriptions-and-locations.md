---
id: B1563
title: The helper claims descriptions and locations are on the page when the day carries none
type: ISSUE
priority: high
complexity: medium
area: helper
found: "2026-09-12T07:31:40Z"
started: "2026-09-12T07:38:17Z"
session: 47912984-b51b-4d11-b25e-5b026ba593de
claimed: "2026-09-12T07:38:17Z"
---

# B1563 — The helper claims descriptions and locations are on the page when the day carries none

## Why

Live session `ed4c4939…` (journal `severin`, 2026-09-12, 07:05): asked to
"beschreibe fotos ergänze text und hole standort raus", the turn ran only
`read_day` and answered *"du findest die Beschreibungen und Standorte auf
der Seite selbst"*. The day carries no captions, no coordinates and a body
of `…`. That is the "Der Text ist gespeichert" class of untrue sentence
the net in `lib/helper/model.ts` exists for — and no guard fired
(`guard` was empty on the row), because no check covers the claim "it is
already on the page".

Part of why the model deflected is B1238 — `describe_photos` has no model
tool, so it *couldn't* do the ask. That ticket stays its own; this one is
the honesty gap: whatever the tools can or cannot do, the answer asserted
content that a read the same turn had just shown absent.

## Work

A new check in `amiss()` (lib/helper/model.ts:2370): a matcher for claims
that descriptions/captions/locations are on the day or page ("findest du
auf der Seite", "are on the page", the three languages), a condition read
from what this turn's `read_day` actually returned (the same way `counted`
and `postcardRecipientsEmpty` are captured near model.ts:2102) — fire when
the day read this turn has neither captions nor coordinates. One retry,
and a plain fallback sentence saying the day has no descriptions or
location yet. Per AGENTS.md: a guard that fires on an honest turn is a bug,
so the condition keys on the read result, never on phrasing alone.

## Acceptance

A test in the model-guard suite: an answer claiming
"Beschreibungen/Standorte auf der Seite" on a turn whose `read_day`
returned a day with no captions and no coordinates is caught; the same
answer after reading a day that has them passes untouched. `npm run
verify` green.
