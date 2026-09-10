---
id: B1234
title: Proving a number needs a template Meta will not grant - the inbound message already proves it
type: FEATURE
priority: high
complexity: medium
area: signup, whatsapp, auth
found: "2026-09-10T05:50:37Z"
started: "2026-09-10T05:51:01Z"
merged: "2026-09-10T06:08:57Z"
---

# B1234 — Proving a number needs a template Meta will not grant - the inbound message already proves it

## Why

B1222 delivers the signup passcode as a WhatsApp **authentication** template,
and B1232 found the wall: Meta only grants that category to businesses that
have passed business verification, which this instance's single-person,
unregistered-Swiss-Einzelunternehmen operator cannot pass without first
creating a formal registration. A utility template carrying the code is
auto-rejected by Meta's reviewer (tried, 2026-09-10). So on the live
instance no template can carry a passcode, and the phone step cannot go
live.

The proof does not need an outbound message at all. An **inbound** message
proves the number by existing (B1065 recorded this as the free option): the
signup page shows a wa.me link whose prefilled text carries a one-time
token; the person taps it and presses send; the webhook (live since the
B1057 family) sees the token arrive *from* a number, and that number is
thereby proven and linked to the signup session. No template, no category,
no review, no per-signup cost — and nobody types a code.

## Decided — 2026-09-10, the owner

Build now. B1232 (verification + authentication templates) stays in the
backlog as optional future polish; the B1222 machinery remains for verified
instances and for dry-run development.

## Work

- `features.signup.phoneBackend` gains the value `"whatsapp-inbound"`.
  Capability-checked against `whatsapp` **and** `whatsappInbound` both being
  on.
- `POST /api/auth/signup/phone/request` in that mode takes no `tel`: it
  writes a pending row (token hash, bound to the signup session) and answers
  with the wa.me link and its prefilled text. Same ceilings.
- The inbound pipeline recognises the token in a text message before the
  helper dispatch sees it: it marks the row proven with the sender's E.164,
  and replies in the free session window with a plain-text confirmation.
- `POST /api/auth/signup/phone/verify` without a `code` becomes the poll:
  `pending` until the webhook has done its work, then `markPhoneProven` and
  the same `{ok, tel}` the code path answers.
- The wizard's phone step, in this mode, shows an "Open WhatsApp" button
  and waits — no number field, no code field. The no-WhatsApp contact line
  stays.
- Contract: openapi + /agent.md.

Not doing: login-over-inbound (the sign-in button keeps the template path,
hidden where undeliverable — a capture of its own if wanted); any change to
the code-mode backends.

## Acceptance

With `phoneBackend: "whatsapp-inbound"` and the webhook live: the wizard's
phone step opens WhatsApp with a prefilled message; sending it flips the
step within seconds and the journal is created with the sender's number
proven. A wrong or expired token changes nothing and the sender is told.
Locally, a simulated webhook POST drives the same path under vitest.


## Built — 2026-09-10

As decided, plus one honesty fix found while building: `telProvenMethod`
gains the value `"whatsapp-inbound"` (config, journals, create route), since
recording the inbound proof as "sms" would be a false statement in the
owner's own config.json.

- `lib/phoneVerify/inboundLink.ts` — token rows on `login_codes`
  (`kind: "phone-link"`, hash-only, 30 min, superseded, single use, bound to
  the signup session), `createPhoneLink`/`claimPhoneLink`/`pollPhoneLink`.
- `lib/whatsapp/dispatch.ts` intercepts the token before the stranger path;
  replies via `sendServiceReply` in the row's locale.
- Routes: request answers with the wa.me link in inbound mode; verify
  without a `code` is the poll; `phone_required` carries `mode`.
- `lib/capabilities.ts`: `phoneBackend: "whatsapp-inbound"` demands
  `whatsapp` + `whatsappInbound` + a configured number.
- Wizard: `phone-wa` step — Open WhatsApp button, waiting line, expiry +
  retry, the no-WhatsApp contact line. Locales en/de/hu.
- Contract: openapi (both phone operations), /agent.md.

Verified: full `npm run verify` green; `test/phone-link.test.ts` (4
scenarios: end-to-end, invented token, session binding, supersession +
replay); driven in headless Chrome against a dev instance in inbound mode —
the wizard reached the phone-wa step, a signature-valid simulated webhook
carried the prefilled message, the page advanced by itself, and the journal
was created with `tel` proven and `telProvenMethod: "whatsapp-inbound"`.
Screenshots in the session scratchpad `b1234/shots/`.

Going live is config only: `features.signup.phoneBackend:
"whatsapp-inbound"` in the VPS config (the number and webhook are already
live there). No Meta review, no business verification — B1232 stays parked.
