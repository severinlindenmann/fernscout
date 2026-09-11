---
id: B1370
title: WhatsApp confirm step still shows the intro text above it
type: ISSUE
priority: high
complexity: low
area: signup wizard
found: "2026-09-10T19:12:03Z"
started: "2026-09-10T19:15:30Z"
merged: "2026-09-10T19:34:22Z"
---

# B1370 — WhatsApp confirm step still shows the intro text above it

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

SignupWizard.tsx now suppresses the intro paragraph and the agent@ mail line on the phone-wa step; the SMS fallback link stays. Check: signup on a phone, WhatsApp step shows only 'Noch ein Schritt…', button, waiting line, SMS link.
