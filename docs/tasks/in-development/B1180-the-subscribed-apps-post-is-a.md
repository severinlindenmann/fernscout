---
id: B1180
title: The subscribed_apps POST is a documented curl, not a one-shot script
type: CHORE
priority: low
complexity: low
area: whatsapp, ops
found: "2026-09-09T20:30:43Z"
started: "2026-09-11T08:26:11Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T08:26:11Z"
---

# B1180 — The subscribed_apps POST is a documented curl, not a one-shot script

## Why

B1163 wrote down the third WhatsApp subscription Meta's Configuration UI
never exposes — `POST /<WABA_ID>/subscribed_apps` — as a documented `curl` in
`docs/providers/whatsapp.md`, because setting it up on the live instance
(2026-09-09) cost about an hour, all of it spent not knowing this call
existed. The doc closes the "nobody knows this step exists" problem; it does
not close the "an operator still has to hand-type a `curl` with a bearer
token" problem. Every future instance repeats that by hand.

## Work

A one-shot `npm run whatsapp:subscribe` (or `scripts/whatsapp-subscribe.mts`,
matching the existing `scripts/*.mts` convention) that:

- reads `WHATSAPP_ACCESS_TOKEN` from the environment,
- takes the WABA id as an argument (or looks it up via the
  `health_status`/`entities` trick B1163 documents, if a phone number id is
  available instead),
- makes the `POST /<WABA_ID>/subscribed_apps` call and prints the result.

Not doing here: any change to the inbound webhook path itself — this is
purely the missing third subscription, a one-time setup step per WABA.

## Acceptance

- Running the script against a real WABA id and a token scoped with
  `whatsapp_business_management` returns `{"success": true}` and the script
  reports success plainly.
- `docs/providers/whatsapp.md` is updated to point at the script instead of
  the raw `curl`, once it exists.
