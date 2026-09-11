---
id: B1180
title: The subscribed_apps POST is a documented curl, not a one-shot script
type: CHORE
priority: low
complexity: low
area: whatsapp, ops
found: "2026-09-09T20:30:43Z"
started: "2026-09-11T08:26:11Z"
merged: "2026-09-11T09:00:31Z"
---

# B1180 — The subscribed_apps POST is a documented curl, not a one-shot script

## Why

VALID, confirmed 2026-09-11: `docs/providers/whatsapp.md` carried the raw
`curl` and said so outright, and `package.json` had no `whatsapp:*` entry.

B1163 wrote down the third WhatsApp subscription Meta's Configuration UI
never exposes — `POST /<WABA_ID>/subscribed_apps` — as a documented `curl` in
`docs/providers/whatsapp.md`, because setting it up on the live instance
(2026-09-09) cost about an hour, all of it spent not knowing this call
existed. The doc closes the "nobody knows this step exists" problem; it does
not close the "an operator still has to hand-type a `curl` with a bearer
token" problem. Every future instance repeats that by hand.

## Work

Built as `npm run whatsapp:subscribe` → `scripts/whatsapp-subscribe.mts`,
matching the existing `scripts/*.mts` convention, that:

- reads `WHATSAPP_ACCESS_TOKEN` from the environment, and refuses outright
  (no dry run) if it is absent — this is a one-shot setup step, not a
  scheduled job, so a dry-run mode has nowhere to earn its place;
- **requires the WABA id directly** (`--waba <id>` or a bare positional
  argument), per the plan-a-run brief's answer: auto-resolving it from a
  phone-number-id would add an API call and a failure mode to a script whose
  whole point is being one shot. The `health_status`/`entities` lookup B1163
  documents stays a manual fallback, and `docs/providers/whatsapp.md` says so;
- makes the `POST /<WABA_ID>/subscribed_apps` call and prints the result;
- never prints or logs the token, in success or in any error path (checked by
  a test that spawns the script with a real-looking token and greps both
  streams for it).

Not doing here: any change to the inbound webhook path itself — this is
purely the missing third subscription, a one-time setup step per WABA. Meta's
API was never called while building or testing this — both refusal paths (no
token, no WABA id) are provable without a network call, and the third path
(a real POST) is exercised on the live instance, not here.

## Acceptance

- Running the script against a real WABA id and a token scoped with
  `whatsapp_business_management` returns `{"success": true}` and the script
  reports success plainly. Not verified here — see the note above about
  never calling Meta's API while building; this line needs a person with a
  real token to run it once against a live WABA.
- `docs/providers/whatsapp.md` is updated to point at the script instead of
  the raw `curl`, once it exists. Done — the raw `curl` is now the fallback,
  after the `npm run whatsapp:subscribe` line, and the old "Not built" section
  at the bottom of the doc is removed.
