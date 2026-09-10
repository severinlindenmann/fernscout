---
id: B1316
title: Twilio SMS - inbound inbox in admin, outbound sending, SMS signup fallback
type: FEATURE
priority: high
complexity: medium
area: sms, twilio, admin, signup
found: "2026-09-10T15:35:17Z"
started: "2026-09-10T15:36:07Z"
merged: "2026-09-10T16:06:31Z"
---

# B1316 — Twilio SMS - inbound inbox in admin, outbound sending, SMS signup fallback

## Why

The operator bought a Twilio Swiss mobile number (+41 76 601 46 49,
domestic-only: it exchanges SMS with +41 numbers only). Nothing in the
codebase can send an SMS (`lib/phoneVerify/twilio.ts` is Twilio *Verify*,
parked) and nothing receives one — an SMS sent to the number today lands
nowhere. Meanwhile the signup phone step (B1222/B1234) has exactly one live
channel, WhatsApp-inbound, and its no-WhatsApp path is a contact-us dead-end.
The owner decided (2026-09-10): signup proves the number via WhatsApp *or*
SMS, and the operator wants inbound SMS readable and manual sends possible
from /admin.

## Work

Per the approved plan (session 2026-09-10):

- `lib/sms/` transport — dry-run + twilio backends, mirroring
  `lib/whatsapp/index.ts`; capability `sms` (env `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`), `features.sms.allowedPrefixes`
  for the domestic restriction; separate `smsInbound` capability.
- Migration 031 `sms_messages` (both directions, `provider_sid` UNIQUE as
  inbound dedupe).
- `app/api/webhooks/twilio/route.ts` — X-Twilio-Signature validated against
  the canonical public URL, rate-limited by sender, stores the message,
  answers empty TwiML.
- `lib/phoneVerify/sms.ts` backend on the shared `codes.ts` lifecycle;
  `channel: "sms"` fallback on `POST /api/auth/signup/phone/request` beside
  `whatsapp-inbound` mode; `phone_required` gains `smsFallback`;
  `telProvenMethod: "sms"`.
- `SignupWizard` phone-wa step: "No WhatsApp? Get the code by SMS" replacing
  the contact-us dead-end (+41 only, `sms_unreachable` otherwise).
- /admin SMS tab: inbox newest-first + send form via
  `POST /api/admin/sms`.
- Contract: openapi + /agent.md for the signup routes.

Not doing: SMS login channel; Twilio Verify; inbox delete/reply;
auto-replies; anything toward B1232. Ceiling capture: B1317.

## Acceptance

Locally with dry-run backends: vitest covers webhook signature/dedupe and
the SMS phone-verify path; the wizard offers the SMS fallback and completes
with a dry-run code. Live: an /admin send arrives on the owner's phone, the
owner's reply shows in the /admin inbox, and a real signup can prove a +41
number by SMS code as well as by the WhatsApp tap.
