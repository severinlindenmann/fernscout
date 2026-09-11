# Flow: owner-new-signup-by-sms

**Persona:** `owner-new` (docs/testing/personas/owner-new.md)
**Interface:** journal UI (signup) + admin UI (the inbound half)
**Capabilities exercised:** `sms`, `smsInbound`
**Device/locale:** run once per requested viewport for the signup screens;
the inbound half has no viewport of its own (it lands in `/admin`'s SMS
panel).
**Check type:** technical (a dry-run code round-trips, an inbound message is
recorded) and graphical (the phone-step screens of signup).

## Setup

1. Local dev server running with `features.signup` on
   (`phoneBackend: "sms"`), `features.sms` on (`backend: "dry-run"` — no
   Twilio account needed, per `lib/phoneVerify/sms.ts` and
   `lib/sms.ts`'s own dry-run discipline), and `features.smsInbound` on with
   `TWILIO_AUTH_TOKEN` set to any non-empty test value (a database is also
   required — `smsInbound`'s own `db: true` requirement in
   `lib/capabilities.ts`, since the webhook has an inbox to write into).
   `phoneBackend: "sms"` is refused at boot unless `features.sms` is also on
   (`lib/capabilities.ts`'s own check: `'features.signup.phoneBackend is
   "sms" but features.sms is not enabled'`), so both switches are needed
   together for this flow, not just the one that sounds relevant.
2. No journal yet for `owner-new` — this persona owns nothing at the start.

## Steps

1. As `owner-new`, start signup at whatever the instance's own signup page
   is, and choose to prove a phone number rather than an email.
2. `POST /api/auth/signup/phone/request` with a test number. Confirm a code
   was issued to the dry-run backend — `lib/phoneVerify/dryRun.ts` writes it
   under `<dataDir>/phone/`, masked, never sent anywhere — and read it back
   from that file the way a developer would with no Twilio account.
3. `POST /api/auth/signup/phone/verify` with the code. Confirm the signup
   token now carries a proven phone number and the flow proceeds to naming
   the journal (`test-<something>`, never a name that reads like a person's
   — AGENTS.md).
4. Simulate the *other* direction — a reply landing on the instance's own SMS
   number, independent of the signup flow that just finished — with a signed
   form-encoded POST to `/api/webhooks/twilio` (this route reads Twilio's own
   `application/x-www-form-urlencoded` body and an
   `X-Twilio-Signature` HMAC-SHA1 over the signing URL plus sorted
   parameters — see that route's own module comment — so it is not one of
   the JSON fixtures `scripts/simulate-webhook.ts` already signs; build the
   signature the same way against the local `TWILIO_AUTH_TOKEN`).
5. Check `/admin`'s SMS panel (as the operator persona, or directly via
   `GET /api/admin/sms`) for the recorded inbound message.

## Done when

- The dry-run code round-trips: request, then verify, and the resulting
  signup token carries the proven number and no other journal claims it
  already (technical check — the registry `lib/journals.ts` keeps against a
  duplicate proven number).
- `phoneBackend: "sms"` with `features.sms` off is refused at boot with the
  named reason above, and the signup route itself never gets as far as
  issuing a code in that state (technical check).
- The inbound message is stored (no dispatch, no model, no auto-reply —
  `app/api/webhooks/twilio/route.ts`'s own stated scope) and a retried
  delivery with the same `MessageSid` does not create a second row
  (technical check).
- The phone-step screens of signup render correctly at the requested
  viewport (graphical check).
