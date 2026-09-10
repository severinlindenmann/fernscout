---
id: B1342
title: Who may read a new trip is asked in prose, not as a choice
type: FEATURE
priority: high
complexity: medium
area: helper
found: "2026-09-10T17:04:28Z"
started: "2026-09-10T17:04:40Z"
merged: "2026-09-10T17:23:49Z"
---

# B1342 — Who may read a new trip is asked in prose, not as a choice

## Why

The create-trip card's visibility select pre-opened on a hardcoded
"guest", which disagreed with what the server actually writes when a create
says nothing — a public journal's trips default to public
(lib/tripWrite.ts). Owner decision E04 A: the default is the journal's own
standard, named on the card (2026-09-10).

## Work

`create_trip`'s propose reads the journal: guest journal → guest, public
journal → public, unknown journal → guest (the closed fallback the card has
always had). The three labelled options and the points-at-the-label sentence
(B923) are unchanged.

## Acceptance

test/helper-tools.test.ts stays green (unknown journals still open on
guest, never private); on the demo journal (public) a create-trip card now
opens on "Öffentlich".
