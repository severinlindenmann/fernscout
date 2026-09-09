---
id: B1163
title: Meta's UI verifies the webhook and subscribes the messages field but never subscribes the WABA to the app, so real inbound is silently dropped
type: DOCS
priority: medium
complexity: low
area: whatsapp, ops, docs
found: "2026-09-09T19:36:07Z"
---

# B1163 — Meta's UI verifies the webhook and subscribes the messages field but never subscribes the WABA to the app, so real inbound is silently dropped

## Why

Setting up WhatsApp inbound on the live instance (2026-09-09) cost about an
hour on one silent failure, and the whole hour was Meta's, not ours. The
symptom: the webhook verifies, the `messages` field shows *Abonniert*, Meta's
own "Testen" (Feldprobe) button delivers a signed test event that the server
processes perfectly — and a real message from a real phone produces **no
webhook call at all**. No error, no delivery attempt, nothing in the log.

The cause is a third subscription Meta's Configuration UI never shows: the
**WhatsApp Business Account** must be in the app's `subscribed_apps`, which is
separate from (a) verifying the callback URL and (b) subscribing the
`messages` webhook field. The UI lets you do (a) and (b) and looks complete.
`GET /<WABA_ID>/subscribed_apps` returned `{"data": []}` while everything the
UI could show was green.

The Feldprobe button is what makes this so expensive: it sends its event
straight to the callback URL, bypassing WABA routing, so it *works* and tells
you the endpoint is fine — which points every diagnostic at the wrong half.

The fix is one API call the UI does not expose:

```
POST https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps
  Authorization: Bearer <token with whatsapp_business_management on the WABA>
→ {"success": true}
```

Two things made even *finding* the WABA id hard, and are worth writing down:
the deployed `WHATSAPP_ACCESS_TOKEN` is a narrowly-scoped SYSTEM_USER token
that returns "nonexisting field" for `whatsapp_business_account` on the phone
number and lists no businesses — but `GET /<PHONE_NUMBER_ID>?fields=
health_status` hands back every entity id (PHONE_NUMBER, **WABA**, BUSINESS,
APP) in its `entities` array. That is the reliable way to get the WABA id from
a send-only token. For this instance it was `1043886595223059`.

## Work

This is a DOCS ticket — the code is correct and needs no change. Write the
setup down where an operator will find it, most likely `docs/providers/` (a
`whatsapp.md`, if none exists) and/or the `vps` deploy notes:

- The three separate subscriptions, in order: verify callback URL → subscribe
  `messages` field → **subscribe the WABA to the app** (`subscribed_apps`).
- The `subscribed_apps` POST, and that the UI does not expose it.
- The Feldprobe-bypasses-routing trap, stated plainly, because it is what
  sends the diagnosis the wrong way.
- The `health_status` → `entities` trick for getting the WABA id from a
  send-only token.
- **Meta's app-level rate limit, because our webhook calls back.** The
  ceiling is **`Calls within one hour = 200 × Number of Users`** — where
  "Number of Users" is the count of people who have engaged the app, per
  rolling hour, across the Graph API. Every reply, mark-read and (later)
  typing-indicator is one such call, so the conversational reply machinery
  (B1056/B1061) has to be designed under it, not discover it. Worth stating
  beside the per-sender E.164 brake B1057 already added, since the two are
  different limits: ours stops one number flooding us, Meta's caps our total
  calls back to them.
- The env keys the inbound path needs: `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN` (beside the existing `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`), and that the app must be **published**, not in
  development mode, or a non-test number is never delivered.

Consider whether `scripts/` should carry a one-shot `whatsapp:subscribe` that
does the `subscribed_apps` POST, so the next instance runs one command instead
of rediscovering this. Note it, do not necessarily build it here.

## Acceptance

- An operator following the doc gets inbound working without hitting the empty
  `subscribed_apps`.
- The Feldprobe trap and the `health_status` id trick are both written down.
