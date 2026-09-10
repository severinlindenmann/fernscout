---
id: B1210
title: Room decisions: the bring-your-own-agent bottom sheet (D11 D12)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:36Z"
started: "2026-09-10T05:10:11Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T05:10:11Z"
---

# B1210 — Room decisions: the bring-your-own-agent bottom sheet (D11 D12)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D11 A, D12 A. "Eigenen Agenten anbinden" currently
navigates away to the dense /me page. It becomes a bottom sheet in the
room: one explaining sentence, one button minting the 20-minute handover
credential, and a complete paste-ready prompt (in the reader's language)
containing the handover URL and first steps, with one copy button; a
"Mehr auf deiner Seite" link to /me for key management.

## Work

The sheet (same Sheet/dialog machinery), a mint call to the existing
handover route, the prompt template in en/de/hu, clipboard copy with the
honest fallback. Entry points: the footer line and the ⋯ menu.

## Acceptance

From the room at 390px: two taps yield a copied prompt that a fresh
agent can follow to a working token (verified once against the live
instance).
