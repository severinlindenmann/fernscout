---
id: B1337
title: A proposal's Save and Leave buttons render detached at the page foot on desktop
type: ISSUE
priority: high
complexity: medium
area: helper
found: "2026-09-10T16:54:18Z"
started: "2026-09-10T16:56:26Z"
merged: "2026-09-10T17:03:04Z"
---

# B1337 — A proposal's Save and Leave buttons render detached at the page foot on desktop

## Why

B1122 pins a proposal card's accept row above the phone keyboard by
rendering it `position: fixed` at the visual viewport's bottom while a field
on the card has focus. `window.visualViewport` exists on desktop too, where
the gap is ~0 — so clicking into a proposal field on a laptop tore
"Speichern / Sein lassen" off the card and pinned it to the window's foot
(owner's screenshot, 2026-09-10). `components/HelperAsk.tsx`, the
`pinBottom` effect.

## Work

The pin only engages when the viewport actually shrank: `pinBottom` is set
only when the computed gap exceeds 80px (below any real keyboard, above any
browser-chrome jitter); otherwise it stays `null` and the buttons sit in the
card as they always did. Phone behaviour under a keyboard is unchanged.

## Acceptance

On a desktop at 1280px, focusing a proposal field leaves the Speichern
button inside the card — no fixed bar at the page foot. On a phone with the
keyboard up, the pinned bar still appears above the keyboard.
