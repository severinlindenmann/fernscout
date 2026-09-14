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

**Whether this channel is even allowed to exist is a separate question,
answered on its own page:** `docs/compliance/whatsapp-ai-policy.md` (B1077)
— Meta prohibits general-purpose AI chatbots on this platform, and that
page is the argument for why this helper is on the permitted side of that
line. Read it before relying on this one operationally.

---

## The number: what it is, and what happens when it lapses

This was never written down before B1067, which is why picking the channel
back up always meant re-deriving it. Numbers below are structural facts
(ids, review states) rather than the number itself — the number and every
recipient's number stay off this page, per the same rule that keeps them out
of the application log.

**The number is the operator's own personal mobile SIM, and it is scheduled
to be given up.** It is not a business line, not a VoIP DID, not bought
through Meta — Meta only hosts the WhatsApp registration on top of
a real mobile subscription, it does not sell numbers. That makes this a risk
rather than a bookkeeping fact: a Swiss mobile number that lapses is
eventually reassigned to someone else, and whoever receives it next can
answer WhatsApp's SMS/voice verification for it. There is no fixed monthly
line item to record here because the SIM sits on the owner's own personal
plan, not a separate business contract.

**What survives a number change, and what does not.** The WABA
(`1043886595223059`), its approved templates and business verification (once
done) are account- or portfolio-level and carry over to a new number
unchanged. What resets: the quality rating and messaging tier (both are
per-number and re-earned from zero), every open 24-hour conversation window,
and every thread a contact already has open with the old number in their own
app — nothing here notifies them the way the consumer WhatsApp app's own
"Change Number" flow does, so contacts have to be told from the old number
while it still works.

**Before the SIM goes, deregister it deliberately —
`POST /{PHONE_NUMBER_ID}/deregister`.** Leaving the contract to simply lapse
means the Meta-side registration lingers in a stale state until whoever gets
the number next tries to register it, at which point Meta's own
account-recovery logic decides what happens to the leftover WABA linkage —
undocumented, and not a thing to test with a family's photographs behind it.
The endpoint is rate-limited to 10 calls per number per rolling 72 hours
(over that: error `133016`, a further 72-hour lock), and it refuses a number
that is in "coexistence" with the consumer app. Turn 2FA/PIN off on the old
number *first* — the most commonly reported blocker in migration write-ups.
No Swiss regulator sets a quarantine period on a recycled mobile number
(recycling is each carrier's own commercial policy, not a BAKOM rule);
comparison-site figures put the low end around four months
(Swisscom postpaid), which is not a safe margin to let a SIM simply lapse on.

**The plan, decided 2026-09-09 and unexecuted, since there is no deadline
yet:** a second, dedicated Swiss mobile SIM on a low-cost business plan,
registered as a *second* number on the same WABA and run in parallel while
contacts are told, then the personal SIM is deregistered. A genuine inbound
port of the existing personal number was researched and found to have no
confirmed path — Twilio's Swiss mobile numbers are explicitly non-portable,
and no other provider was found that accepts an inbound port of an existing
Swiss mobile number into an API-driven platform. If porting is ever a hard
requirement, that needs a sales call, not another search.

**Business verification: deliberately not done, and worth re-asking.**
`business_verification_status` reads `not_verified` (business id
`1154303934071130`); the practical effect today is a 250-unique-recipient/24h
ceiling that never binds at family scale, so the owner deferred it on
2026-09-09. The one thing that changes the calculus: verification lives on
the Business Portfolio, not on the WABA or the phone number, so it is
independent of the number succession above and carries forward regardless of
which number ends up attached. Doing it now — while the account is stable —
removes one variable from a migration that has to happen anyway; that was
flagged back to the owner and is still open.

**The SMS proof channel this ticket also chased is moot — nothing was ever
bought.** B1065 first chose SMS (a paid provider, ultimately Twilio Verify)
as the way to prove a signup phone number, which is what made a provider
account "blocking" in this ticket's own history. B1234 (merged 2026-09-10)
replaced that plan entirely with a free WhatsApp-inbound proof — the person
taps a prefilled `wa.me` link and the webhook sees the token arrive from
their number, no template and no per-signup cost. The live config confirms
it: `features.signup.phoneBackend` is `"whatsapp-inbound"` on fernscout.ch
today. `lib/phoneVerify/twilio.ts` exists as an alternate backend but has
never been driven against a real Twilio account and nothing currently live
uses it. So: no SMS provider was chosen, and none is needed unless
`phoneBackend` is deliberately switched back to `"twilio"` — at which point
the unverified claims recorded against B1065/B1067 (Verify's sender
handling, its per-country price to CH/DE/AT/HU) still need confirming before
anything is switched.

**The webhook's own two secrets are already where B1067 asked to confirm
they were** — `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`, both in
`/etc/fernscout/env` alongside `WHATSAPP_ACCESS_TOKEN` and
`WHATSAPP_PHONE_NUMBER_ID` (see Environment, below).

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
