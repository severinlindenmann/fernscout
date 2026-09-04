---
id: B365
title: A published day can only be announced by email
type: FEATURE
priority: high
complexity: high
area: lib/whatsapp, lib/contacts, lib/digest, publish route, contact forms
found: "2026-09-04T20:43:09Z"
started: "2026-09-04T20:43:40Z"
session: eec89d07-7ecf-4192-80f6-04b56f1c63c6
claimed: "2026-09-04T20:43:40Z"
---

# B365 — A published day can only be announced by email

## Why

`send_mail` on the publish call (B345) is the only way a reader learns a day
went up. A journal's readers are family, and the family reads WhatsApp — an
address they check weekly against an app they check hourly. `lib/contacts`
already stores a telephone number (`PostalAddress.tel`, encrypted alongside
the postal address in `lib/contacts/crypto.ts:36`), collected on the same
guestbook screen as the address, so the data is there and nothing uses it.

The constraint that shapes the whole design: **outside a 24-hour customer
service window, the WhatsApp Cloud API accepts only pre-approved templates.**
A publish notice is by definition business-initiated, so the message is a
template with an image header, body variables and a URL button — never
free-form prose. Meta's review takes up to 24h, which means the template's
shape is a compatibility surface, not an implementation detail.

Two things it must not become:

- **A second notification system.** Recipients, trip-visibility gating and the
  owner-always rule are `lib/digest/dayLetter.ts`'s and must stay there.
- **Consent inherited from mail.** Meta's Business Messaging Policy wants
  explicit opt-in *to be messaged on WhatsApp*. `wantsEmailDigest` is not that,
  and `PostalAddress.tel` was collected for postcards. A separate
  `wantsWhatsapp` is the only honest reading, and it is what keeps the number
  from being banned.

## Work

- `lib/whatsapp/` mirroring `lib/mail/`: a `WhatsappTransport` interface, a
  `dry-run` backend writing JSON under `content/<user>/whatsapp/` so the
  feature develops with no Meta account, and a `cloud` backend calling the
  Graph API. Nothing outside the module knows which.
- `features.whatsapp` in `lib/config.ts` + `lib/capabilities.ts`, off by
  default, requiring `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` /
  `WHATSAPP_WABA_ID` for the `cloud` backend and nothing for `dry-run`.
  Secrets are environment only.
- Migration `015`: `contacts.wants_whatsapp`. `ContactRecord.wantsWhatsapp`,
  and an `isMessageable` gate beside `isPostable` — consent without a number
  is not consent, the same way `wantsPostcard` needs a postable address.
- The four consent doors, all of them: `app/api/contacts/{request,redeem,
  manage,admin}/route.ts` and `components/{ContactForm,InviteRedeem,
  ContactManage,ContactsAdmin}.tsx`.
- `lib/digest/dayWhatsapp.ts` reusing `dayLetter.ts`'s recipient rules;
  `lib/api/dayWhatsapp.ts` for `send_whatsapp` and the response summary.
- `send_whatsapp` on the publish route, and a standalone
  `days/<slug>/send-whatsapp` route mirroring `send-mail` for a day already
  on the site. Absent means no send, never a default true.
- Per-locale template names in config, falling back to the journal's locale
  rather than failing. Image header uploaded via `POST /<phone-id>/media`.

**Not doing:** inbound webhooks, replies, or the 24h free-form window. Nothing
here reads a message; this is one-directional announcement only.

**Flagged for the owner, not solved here:** an image header hands the day's
photo to Meta, including for a `private` trip. B345 deliberately inlines
photos into mail rather than linking, to keep them behind the gate. This is a
weaker position and the owner chose it knowingly; the docs must say so.

## Acceptance

- `npm run verify` green.
- With `features.whatsapp.enabled: false`, `/api/health` explains why it is off
  and the publish route ignores `send_whatsapp` without erroring.
- With the `dry-run` backend, publishing with `send_whatsapp: true` writes one
  JSON payload per opted-in contact under `content/<user>/whatsapp/` and
  reports counts — never numbers — in the API response.
- A contact with `wantsWhatsapp` but no `tel` receives nothing and is not an
  error.
- Ticking the WhatsApp box in each of the four forms round-trips through its
  route and back.
