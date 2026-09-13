---
id: B1562
title: Asking for a preview is answered with a publish_day proposal
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-12T07:31:35Z"
started: "2026-09-12T07:38:15Z"
merged: "2026-09-13T19:08:49Z"
---

# B1562 — Asking for a preview is answered with a publish_day proposal

## Why

Live session `893fc9b4…` (journal `severin`, 2026-09-12, 07:03): the owner
typed **"vorschau"** — a request to *see* the day — and the turn proposed
`publish_day`. The card does render a preview, but the button under it
publishes, and the owner pressed it: an empty day went live off the back of
a request that never asked for publication. A preview request answered with
a publish button is a consent trap, and the `dropped` guard that fired on
the same turn recovered the prose but not the proposal.

The read path already has the right shape: the day-reading tool's `preview`
block (`lib/helper/tools/areas/days.ts`, `shape: "preview"`) shows a day
without offering any button.

## Work

A deterministic check, not prompt wording (B829): when the sentence asks
only to see/preview (de "vorschau", en "preview", hu "előnézet" stems, with
no publish word alongside), a `publish_day` proposal must not be offered.
The natural home is the same pre-model layer as `lib/helper/intents.ts`'s
refusals, or a post-turn drop of the proposal with the preview block drawn
instead — pick whichever is smaller in the building.

Not doing: refusing the sentence outright (it deserves an answer — the
day, rendered), and not touching sentences that say both ("preview and then
publish") — those keep the card.

## Acceptance

A turn whose user sentence is "vorschau" (and nothing publish-like) never
carries a `publish_day` proposal; the day is shown instead. A sentence that
asks to publish still gets the card. A test in `test/` covers the three
languages' preview words; `npm run verify` green.


## Verified 2026-09-13 — already merged, and the guard proven by reverting

The fix was on `main` already and the task file had simply not been moved. An
agent confirmed the code, and flagged honestly that it could not run the
"fails when reverted" check because there was no local diff to revert.

That check has now been done directly against `main`: reverting the `isPreviewOnly` intercept in `run.ts` fails `helper-preview-intent` in all three languages (de, en, hu).

So the guard is real rather than a test that would pass either way.
