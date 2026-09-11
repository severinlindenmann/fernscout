# WhatsApp provider

What is built, and exactly what Meta's Configuration UI does not tell you
while you are setting up inbound.

**Status: outbound send is wired (`lib/whatsapp/cloud.ts`), and inbound is
built end to end (dispatch, consent gate, helper turn) as of the run that
shipped it.** Getting the *first* real message from a real phone through the
webhook on the deployed instance (2026-09-09) cost about an hour, and the
whole hour was Meta's, not ours: the webhook verified, `messages` showed
*Abonniert* in the UI, Meta's own "Testen" (Feldprobe) button delivered a
signed test event the server processed perfectly — and a real message from a
real phone produced no webhook call at all. No error, no delivery attempt,
nothing in the log. This page exists so the next instance does not spend that
hour again.

---

## The three subscriptions, in order

Meta's Configuration UI shows two of these and completes neither of them
end to end. All three have to be done, in this order, before a real number's
message reaches the webhook:

1. **Verify the callback URL.** The UI's "Callback URL" + "Verify token"
   fields, checked with a `GET` challenge against `WHATSAPP_VERIFY_TOKEN`.
2. **Subscribe the `messages` field.** The UI's webhook fields list, ticked
   next to *Abonniert*.
3. **Subscribe the WhatsApp Business Account (WABA) to the app** —
   `POST /<WABA_ID>/subscribed_apps`. **The UI never shows this step, and
   never tells you it is missing.** Steps 1 and 2 both show green with step 3
   still undone; `GET /<WABA_ID>/subscribed_apps` on this instance returned
   `{"data": []}` while everything the UI could show was green.

### The subscribed_apps POST

```
npm run whatsapp:subscribe -- --waba <WABA_ID>
```

Run it once per WABA, after steps 1 and 2, with `WHATSAPP_ACCESS_TOKEN` set to
a token scoped with `whatsapp_business_management` on that WABA. Prints
`{"success": true}` on success (B1180 — `scripts/whatsapp-subscribe.mts`).
There is no UI control for this step; the script (or the raw call it makes,
below, if you would rather run it by hand) is the only way to do it.

```
POST https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps
Authorization: Bearer <token with whatsapp_business_management on the WABA>

→ {"success": true}
```

---

## The Feldprobe trap

Meta's "Testen" (Feldprobe) button in the Configuration UI sends its test
event **straight to the callback URL**, bypassing WABA routing entirely. It
therefore proves the endpoint works — TLS, signature verification, the route
handler — while telling you nothing about whether the WABA is actually
subscribed. A real message routes through `subscribed_apps`; the test button
does not. This is what sends the diagnosis the wrong way: everything you can
click to test looks fine, and the one thing that is actually broken has no
test button of its own.

**If the webhook verifies, the field shows subscribed, the Feldprobe button
works, and a real phone still produces nothing in the log — check
`subscribed_apps` before anything else.**

---

## Finding the WABA id from a send-only token

The deployed `WHATSAPP_ACCESS_TOKEN` is a narrowly-scoped SYSTEM_USER token.
It returns "nonexisting field" for `whatsapp_business_account` when queried on
the phone number, and lists no businesses. The reliable way to get the WABA id
from a token that can only send:

```
GET /<PHONE_NUMBER_ID>?fields=health_status
```

The response's `entities` array hands back every related id — PHONE_NUMBER,
**WABA**, BUSINESS, APP — even though none of those fields are individually
queryable with this token. For this instance the WABA id turned out to be
`1043886595223059`.

---

## Rate limits: two different ceilings

- **Ours (per-sender):** an E.164 brake (B1057) — stops one number flooding
  this server with inbound messages.
- **Meta's (app-level):** `Calls within one hour = 200 × Number of Users`,
  where "Number of Users" is the count of people who have engaged the app,
  measured per rolling hour, across the whole Graph API — not just this
  webhook. Every reply, every mark-read call and any future typing indicator
  is one such call. This is Meta's ceiling on how often *we* may call back
  *them*, and it is why the conversational reply machinery (dispatch,
  held-answer delivery) has to be designed under it rather than discover it
  live. It caps total outbound Graph calls; our brake caps inbound abuse from
  one number. They do not substitute for each other.

---

## Environment

Outbound alone needs:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

Inbound additionally needs:

- `WHATSAPP_APP_SECRET` — verifies the `X-Hub-Signature-256` on every webhook
  call
- `WHATSAPP_VERIFY_TOKEN` — answers the callback-URL verification challenge
  (step 1 above)

**The app must be published, not left in development mode.** A Meta app in
development mode only delivers webhooks for numbers explicitly added as
testers; a non-test number's message is accepted by Meta and never delivered
to the callback URL, which looks identical to the `subscribed_apps` failure
above from this server's side. Check the app's mode before re-chasing the
subscription checklist a second time.
