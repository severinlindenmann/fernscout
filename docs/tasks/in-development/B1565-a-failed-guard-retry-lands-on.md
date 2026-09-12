---
id: B1565
title: A failed guard retry lands on a dead-end fallback sentence
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-12T07:31:50Z"
started: "2026-09-12T07:38:19Z"
session: 47912984-b51b-4d11-b25e-5b026ba593de
claimed: "2026-09-12T07:38:19Z"
---

# B1565 — A failed guard retry lands on a dead-end fallback sentence

## Why

Live session `ed4c4939…` (journal `severin`, 2026-09-12, 07:04): the owner
typed "wegänzen" (a typo for "ergänzen"). The turn ran
`attach_files,inbox,attach_files`, **proposed** `attach_files` — and the
`list` guard fired, the retry failed, and the shipped answer was the
fallback `agent.theListIsAbove`: *"Schau dir die Optionen an, die du schon
bekommen hast — wähl eine aus."* A card was on the screen and the sentence
beside it pointed backwards at an old list instead of at the card.

Per AGENTS.md, a guard that fires on an honest turn is as serious a bug as
one that misses. `saysTheListAgain` (lib/helper/model.ts:1901) — or the
`list` fallback — has no notion of "this turn also proposed something",
so the one sentence a person gets buries the proposal they were given.

## Work

Smallest honest fix in the building, one of: (a) `saysTheListAgain` does
not fire when the turn carries a proposal (the answer isn't *only* the list
again), or (b) the `list` fallback, when `proposals.length > 0`, says
"proposal on your screen — press it if it is right" instead of pointing at
the rows. Decide from what the guard's own tests assert.

## Acceptance

A turn that proposes a tool and whose prose partially repeats a list never
ships "look at the options above" as its whole answer — a test capturing
this turn's shape (blocks + proposal + list-echoing prose) passes with a
sentence that names the proposal. Existing `list`-guard tests stay green.
`npm run verify` green.
