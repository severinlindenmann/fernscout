---
id: B1232
title: Authentication templates are gated on a business verification this account has not passed
type: OPS
priority: high
complexity: low
area: whatsapp, signup, meta
found: "2026-09-10T05:40:41Z"
---

# B1232 — Authentication templates are gated on a business verification this account has not passed

## Why

B1222 shipped the WhatsApp phone-passcode flow; going live needs an approved
**authentication**-category template. Creating one on WABA `1043886595223059`
is refused with error 10 / subcode 2388185, and the health check names the
cause: business `1154303934071130` is `not_verified` (error 141010). Meta
gates authentication templates on business verification, and verification is
a manual Business-Manager step — documents, sometimes days of review — that
no API call can substitute for.

Two dead ends, tried on 2026-09-10 and worth not re-trying:

- A **UTILITY** template carrying the code is auto-REJECTED at submission
  (Meta's reviewer catches OTP content in any non-authentication category).
  The rejected attempt still sits on the name: `fernscout_auth_code` / `en`,
  template id `1635433008002315`, status REJECTED, category UTILITY.
- **Editing** that rejected template's category to AUTHENTICATION is refused
  (subcode 3835031 — category cannot be updated).

## Work

A person, in Meta Business Manager for business `1154303934071130`:

1. Complete **business verification** (Settings → Business info → Start
   verification). Solo/no-Handelsregister may need personal documents.
2. When verified, the templates are one command (run from the VPS so the
   token stays there — see the vps skill). If creating `fernscout_auth_code`
   in `en` conflicts with the rejected leftover, resubmit that template id
   with authentication components, or use `fernscout_auth_code_v2` and point
   `features.whatsapp.authTemplates` at it:

   ```
   POST /1043886595223059/message_templates
   {"name":"fernscout_auth_code","language":"<en|de|hu>",
    "category":"AUTHENTICATION",
    "components":[{"type":"BODY","add_security_recommendation":true},
                  {"type":"FOOTER","code_expiration_minutes":30},
                  {"type":"BUTTONS","buttons":[{"type":"OTP","otp_type":"COPY_CODE"}]}]}
   ```

3. Set `features.signup.phoneBackend: "whatsapp"` in the deployed config
   and restart.

Also worth knowing: the display name is not yet approved (health check),
which caps the messaging limit — the same Business Manager visit can chase
both.

## Acceptance

`fernscout_auth_code` exists APPROVED in en, de and hu on the WABA; a real
signup on fernscout.ch delivers its passcode on WhatsApp; the wizard's phone
step completes with it.

