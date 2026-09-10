---
id: B1222
title: The phone passcode has no live transport - the decided Twilio backend is on hold
type: FEATURE
priority: high
complexity: medium
area: auth, signup, otp, whatsapp
found: "2026-09-10T04:47:42Z"
started: "2026-09-10T04:58:19Z"
session: 445f2c45-9999-43e6-8154-3b9b49a0d13f
claimed: "2026-09-10T04:58:19Z"
---

# B1222 — The phone passcode has no live transport - the decided Twilio backend is on hold

## Why

B1065 built the whole phone-proof flow behind the seam it specified —
`startVerification(phone, locale)` / `checkVerification(id, code)` in
`lib/phoneVerify/types.ts` — with the `dry-run` backend as the only
implementation. On a deployed instance nothing can actually deliver a
passcode to a telephone, so the signup step B1064 inserted cannot be switched
on for real people.

B1065's decided real backend was Twilio Verify, resting on two claims it
itself marked UNVERIFIED. **The owner has now put Twilio on hold** (this
ticket, 2026-09-10): no Twilio for the moment. The instance already has a
working WhatsApp Business Cloud channel (`lib/whatsapp/cloud.ts`, template
sending, the B1057 family), so the passcode should ride the channel that
already exists rather than a provider relationship that does not.

## Decided — 2026-09-10, the owner

- **The live transport is a WhatsApp business-initiated template message**
  ("utility message" in the owner's words), sent through the existing
  `lib/whatsapp` Cloud API plumbing. Not Twilio, not SMS — for the moment.
- **The verification UI must say what is happening**: wording to the effect
  of *"Sending your passcode using WhatsApp"* while the code is on its way.
- **And it must name the way out for somebody without WhatsApp**: wording to
  the effect of *"If you don't have WhatsApp, please contact us at
  agent@fernscout.ch"*. That address is the public contact one, per
  policy — never the operator's personal address.

## Work

- A `whatsapp` backend beside `lib/phoneVerify/dryRun.ts`, behind the same
  two-call seam. Unlike Verify, WhatsApp is a transport, not a verification
  service — so this backend reuses the repository's own OTP discipline
  (`kind: "phone"` on `login_codes`: hash-only, 30-minute TTL, 5-attempt
  burn, supersession) exactly as `dryRun.ts` already does, and only the
  delivery differs. That dissolves B1065's "whose discipline is it" fork:
  ours, on both backends.
- One approved Meta template carrying the code. Note Meta's template
  categories: one-time passcodes are required to use the **authentication**
  category (with its code button), not utility — whoever builds this uses
  whichever category Meta will actually approve for an OTP, and records
  which in the ticket.
- Capability wiring: on only when the WhatsApp capability is configured;
  `/api/health` says why it is off. B1065's ceilings stand (3/number/day,
  5/address/day, 50/instance/day; refuse, never queue).
- The two UI strings above, in all three locales (`npm run i18n:keys`,
  real German and Hungarian).
- The test-journal path (code written to disk, never sent) is untouched.

Not doing: SMS or any Twilio wiring (parked, revisit when the owner says);
any change to email login codes; re-proving a number after signup (B1065's
signup-only decision stands).

## Acceptance

On an instance with the WhatsApp capability configured, a real signup's phone
step delivers the passcode as a WhatsApp template message to the typed
number; the page says it is sending the passcode via WhatsApp and shows the
no-WhatsApp line with agent@fernscout.ch. Locally, with no Meta account, the
whole flow still runs against the dry-run backend. The ceilings refuse a
hundredth message rather than queueing it.

## Revalidated, and widened by the owner — 2026-09-10

**Valid.** `lib/phoneVerify/index.ts` dispatches to `dry-run` and `twilio`
only; there is no WhatsApp backend. Worse than the ticket knew:
`components/SignupWizard.tsx` has steps email → code → journal → trip and
**no phone step at all**, so a real (non `test-`, non-operator) wizard signup
dies at `phone_required` from `POST /api/v1/journals` (route line 388). The
wizard step is therefore in scope — it is where the two decided UI sentences
live.

**The owner widened the scope in the same breath as "build it":**

- Signup proves **both** the address and the number, as B1064/B1065 decided —
  unchanged, except the passcode now arrives by WhatsApp.
- **Login stays email-first by default**, but under the email field the
  person can press *"Send me the code using WhatsApp"* — the same one-time
  code, delivered as a WhatsApp authentication template to the number proven
  at signup instead of as a mail. After signup (both proven), either channel
  signs the owner in. This supersedes B1065's "login stays email passcode
  only" — the owner's own words, 2026-09-10.

## Design settled while building

- The code lifecycle is **ours on every backend** (`login_codes`,
  `kind: "phone"`): the storage half of `dryRun.ts` is shared; the WhatsApp
  backend differs only in delivering the code as a template message.
- Template: Meta requires the **authentication** category for OTPs. The name
  is configuration (`features.whatsapp.authTemplates`, locale → name, same
  fallback shape as `templateFor`), defaulting to `fernscout_auth_code` —
  a wrong name fails loudly at Meta, which is the failure we want.
- `channel: "whatsapp"` on `POST /api/auth/request`: uniform 202 stands.
  The code goes out over WhatsApp only when the address is the journal
  owner's and `owner.tel` was proven; anything else is a silent 202, exactly
  the property the mail path already has for an unknown address.
