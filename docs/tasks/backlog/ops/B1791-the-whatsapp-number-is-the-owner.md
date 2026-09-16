---
id: B1791
title: The WhatsApp number is the owner's personal SIM, and the Twilio number meant to replace it cannot be verified by Meta
type: OPS
priority: high
complexity: medium
area: whatsapp, meta, twilio, sms, provider
found: "2026-09-15T09:26:39Z"
---

# B1791 — The WhatsApp number is the owner's personal SIM, and the Twilio number meant to replace it cannot be verified by Meta

## Why

B1067 established the risk and it has not moved: **+41 78 217 26 46, the
WhatsApp Business number this instance sends on, is a SIM belonging to the
owner personally, and it will be given up.** A lapsed Swiss mobile number is
reassigned after four to eighteen months depending on the operator, and
whoever holds it next can receive WhatsApp's verification for it. The WABA and
its approved templates survive a number change; the number readers see does
not, and neither do existing threads.

The obvious replacement was the Twilio number this instance already owns,
**+41 76 601 46 49**. On 2026-09-15 the owner tried to verify it with Meta and
no code ever appeared in /admin. **That number cannot be the WhatsApp number,
and the reason is structural, not a bug.**

## What was established — 2026-09-15

Driven against the live instance and Twilio's API. Recorded so none of it is
re-derived.

### The inbound webhook was never the problem

The first suspicion was that B1316's remaining owner step — pointing the
number's "a message comes in" webhook at the app — had never been done. It
had.

- `sms_url = https://fernscout.ch/api/webhooks/twilio`, method POST, on the
  Swiss number.
- `smsInbound` reads `enabled: true` on `/api/health`.
- A real inbound SMS from the owner's phone arrived and was stored while this
  was being investigated: `[sms:inbound] •••••••3150 — 4 chars`, 11:03:41.

So the receive path works end to end. **Do not re-investigate it.**

### Meta's code never reached Twilio at all

Twilio's own message log for the account holds five messages across five days
— two inbound from the owner's Swiss mobile, three outbound. **There is no
Meta message in it, delivered or failed.** Nothing arrived for the app to
miss, so the drop is upstream of Twilio entirely.

### Why, and why no Swiss Twilio number can fix it

The Swiss number carries Twilio's domestic-only sender restriction already
recorded in B1317: it exchanges SMS with +41 senders only. Meta sends the
verification code from a foreign sender. The API also reports
`capabilities: {sms: true, voice: false}` — so the "call me instead" fallback
is dead too, and there is no second route to a code.

Checked across every Swiss number type Twilio sells, and the trap is
complementary:

| Twilio CH type | SMS in | Voice | $/month |
| --- | --- | --- | --- |
| Mobile | +41 only | **no** | 9.00 |
| Local | **no** | yes | 1.15 |

Neither can complete a Meta verification. **No Twilio Swiss number can ever be
the WhatsApp number.** This is the dead end worth recording; it looks
promising every time it is reconsidered.

Note the trap that caused the wasted round: `capabilities.sms = true` means the
number can carry SMS, **not** that it accepts international inbound. The Swiss
number reports `sms: true` and still cannot receive Meta's code.

### The target chosen, and bought

**GB Mobile — the only GB type carrying both SMS and voice.** GB national,
local and toll-free are voice-only. Voice matters as much as SMS here: it is
the second route to a verification code if the SMS is filtered.

A second trap, also worth recording: the number search reports
`address_requirements: none` for GB mobile, and a purchase still fails with
`21649 Bundle required and not provided for country: [GB]`. **An address
requirement and a regulatory bundle are different things.** The existing
approved bundle (`Regul Severin`) is scoped `CH mobile individual` and does not
carry over — bundles are per country + number type + end-user type. GB mobile
individual needs Proof of Identity (the existing approved PDF was reusable) and
Proof of Address (`individual_address`, which the account did not hold).

Done on 2026-09-15: bundle `GB Reg` submitted, reviewed and `twilio-approved`;
**+44 7862 131685** bought at $2.50/month, `sms: true`, `voice: true`,
`sms_url` pointed at `https://fernscout.ch/api/webhooks/twilio` POST. No code
change was needed for inbound — `listSms` filters by nothing, so a second
number's messages appear in /admin already.

The Swiss number is untouched and still serving. **Do not release it.**

### The GB number carries SMS both ways — proven 2026-09-15

The question the Swiss number failed. Driven end to end, both directions
international:

- **Outbound GB → CH.** `SM763806d440d762f529b4bdb369adcc3c`, from
  +44 7862 131685 to the owner's Swiss mobile: `delivered`, no error code.
- **Inbound CH → GB.** The owner's reply reached Twilio at 11:29:09 and the
  app stored it the same second: `[sms:inbound] •••••••3150 — 4 chars`.

So a GB long code reaches a Swiss mobile, **and accepts international inbound**
— which is exactly what +41 76 601 46 49 cannot do and why Meta's code never
arrived. The verification in step 2 now has a route.

The send was made by calling Twilio directly with `From=+447862131685`.
`TWILIO_FROM_NUMBER` was deliberately **not** changed, so live signup OTPs
still go out on the Swiss number until the migration is decided.

## Where this stopped — 2026-09-15

**Meta rate-limited the number before the voice route was ever tested.**
`#2494158` — "You have requested a verification code too many times."
Reported cooldowns are commonly 1 hour and escalate to several hours or 24
with repeated attempts; Meta publishes no figure. **Do not retry in a loop —
each attempt appears to extend the window.**

### What is now known about Meta and SMS

Meta's verification SMS never arrived on **either** Twilio number:

| Number | Meta SMS arrived |
| --- | --- |
| +41 76 601 46 49 (CH mobile) | no |
| +44 7862 131685 (GB mobile) | no |

And inbound SMS to the GB number **demonstrably works** — the owner's own
reply was received and stored. So the failure is not Twilio filtering inbound
and not this codebase. The explanation, researched 2026-09-15: **mobile carriers apply A2P
filtering to short-code SMS from large platforms like Meta when the
destination is a VoIP or virtual number, and drop it at the carrier edge
before it reaches the CPaaS provider.** Both numbers are CPaaS numbers.

This fits the evidence better than "Twilio blocked it": a message Twilio
refused would still appear in the message log as rejected, and there is no
entry at all. Nothing arriving is what a carrier-edge drop looks like.

**Voice is the documented workaround** — for virtual numbers it is reported as
the reliable channel for first-time WhatsApp Business API verification,
precisely because it does not cross the SMS A2P filter.

Source caveat: this comes from third-party technical write-ups, not from a
Twilio or Meta document — neither publishes the behaviour. It is the
best-supported explanation, not a vendor statement, and one voice attempt
settles it.

### The voice route, armed but untested

The GB number's `VoiceUrl` is set to a Twimlet that auto-answers and records
with transcription:

```
https://twimlets.com/echo?Twiml=<Response><Record maxLength='40'
  playBeep='false' transcribe='true' trim='do-not-trim'/></Response>
```

When the cooldown lifts, **spend the attempt on the voice call, not on SMS** —
SMS has failed twice and voice is the only untested route. Pull the recording
and transcript from the Calls/Recordings API afterwards.

**If voice fails too**, that is the answer, not a setback: no CPaaS number can
hold this registration, and B1067's recommendation — a second dedicated Swiss
SIM on a real operator at CHF 10–25/month — becomes the path. The GB number is
not wasted in that case; it still resolves B1317, which the Swiss number never
could.

## Voice verification works — proven 2026-09-15

**The GB number completed Meta verification by voice**, after SMS failed on
both numbers. Meta called from +44 161 694 8777; the number auto-answered via
the Twimlet, and the 15-second recording carried the code.

So the researched explanation holds: **SMS is filtered at the carrier edge for
virtual numbers, voice is not.** A CPaaS number can hold this registration,
through voice only.

Two practical notes for the next time:

- **Twilio's transcription is useless here.** It transcribes English, the call
  is German, and it returned `"The police code loud hood, i knew him soon."`
  — that is "Dein WhatsApp Code lautet". Download the recording and listen;
  do not trust `transcribe='true'`.
- **Re-verification will need the voice route every time.** That is the
  standing cost of a CPaaS number versus a physical SIM, and it is the real
  argument in the product question below — not the monthly price.

## The number landed on the wrong WABA — open 2026-09-15

Verification succeeded onto WABA **1451782100105607**, not the instance's
WABA **1043886595223059**. This instance's access token **cannot read the new
WABA at all** (`GraphMethodException` 100/33) — it is a separate asset.

**The fix is to move the number to the existing WABA, not to repoint the app.**
Templates are WABA-level: the three approved `fernscout_day_published_v2`
templates live on 1043886595223059, and business verification is
portfolio-level. Repointing the app would mean recreating and re-approving
every template, assigning the system user and issuing new credentials. Moving
the number costs one re-verification and nothing else.

Steps, all console work on Meta's side:

1. Remove/deregister +44 7862 131685 from WABA 1451782100105607 — a number
   lives on one WABA at a time.
2. Add it to WABA 1043886595223059.
3. Verify **by voice**; SMS will be filtered again. The Twimlet is still armed
   on the number.

**Caution:** this is a second verification on a number that already hit the
rate limit today. If refused, wait — the cooldown escalates with retries.

Also worth establishing: whether the new WABA sits under a different business
portfolio. If the flow created one, that is what split the assets and is the
thing not to repeat.

## The switch, once the number is on the right WABA

No code change. Two values, both on the VPS, and they must move together —
nothing derives the dialable number from the phone number id.

| Where | Key | From → To |
| --- | --- | --- |
| `/etc/fernscout/env` | `WHATSAPP_PHONE_NUMBER_ID` | `1253568101181150` → the new id |
| `/etc/fernscout/env` | `WHATSAPP_WABA_ID` | **currently empty** → `1043886595223059` |
| `/var/lib/fernscout/config.json` | `features.whatsapp.number` | `+41 78 217 26 46` → `+44 7862 131685` |

Then restart. Before switching, on Meta's side: `POST /{phone_number_id}/register`
with a 6-digit PIN (verification alone does not let it send), confirm the three
templates show as available to the new number, and check its display name —
"Fernscout" is approved per number, not inherited.

**Do not change `features.whatsapp.defaultCountryCode` (`"41"`).** It states
where the people filling in this instance's forms are standing, not where the
sender number is; setting it to 44 would misread every Swiss national number a
contact types. The inbound webhook is WABA-level and follows automatically.

## The Twilio half is migrated — done 2026-09-15

SMS now sends on the UK number, and the domestic ceiling is gone. No code
change; two live values:

| Where | Key | Now |
| --- | --- | --- |
| `/etc/fernscout/env` | `TWILIO_FROM_NUMBER` | `+447862131685` |
| `/var/lib/fernscout/config.json` | `features.sms.allowedPrefixes` | **removed** (unset means no restriction) |

Backups kept as `env.bak-20260915` and `config.json.bak-20260915`. Service
restarted, `/api/health` green, `sms` and `smsInbound` both enabled. Verified
by a real send that arrived on the owner's phone from the UK number, and by an
/admin send after the restart.

**This closes B1317** — the instance is no longer Swiss-only for SMS. The
prefix guard existed solely because the Swiss number could not leave `+41`.

Noticed while verifying, filed as **B1800**: /admin shows an outbound row as
`to +<recipient>` and never names the sender, which was complete with one
number and is not with two.

The Swiss Twilio number (+41 76 601 46 49, $9/month) is now redundant for
sending and still costs money. It is kept for the moment because contacts may
have texted it; releasing it is the owner's call, not this ticket's.

## The new WABA is all but ready — 2026-09-15

Decision taken by the owner: **build on the new WABA `1451782100105607`**
rather than move the number back to the old one.

Granting the system user (`Employee`, `122107023891457078`) full control of
the new WABA was enough — **no new access token was needed**, and the existing
one now reads it. The API Setup page was never required; the ids came from the
Graph API.

| | |
| --- | --- |
| Phone number id | `1301526083048758` |
| Number | +44 7862 131685 |
| Display name | Fernscout — already approved |
| `code_verification_status` | VERIFIED |
| `status` | CONNECTED |
| `subscribed_apps` | **already contains app 2155097351770602** |

**The app is reused, not replaced.** The app secret the owner read off the
dashboard hashes identical to `WHATSAPP_APP_SECRET` in the live env, so
`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and the callback URL all stay
as they are. A Meta app is not bound to one WABA.

That also means the `subscribed_apps` trap this repository documents
(`docs/providers/whatsapp.md`) was already satisfied — worth checking rather
than assuming next time, since the UI still never shows it.

### Templates — the only gap, and it is closed pending review

The new WABA had only `hello_world`. The three approved
`fernscout_day_published_v2` templates (de/en/hu) were recreated on it from the
old WABA's own definitions, read back through the Graph API so the wording,
buttons and examples are the approved ones rather than retyped.

The `header_handle` on an IMAGE header is **WABA-specific and cannot be
copied** — the sample image had to be re-uploaded through the Resumable Upload
API to get a fresh handle. Two notes for whoever does this again:

- `POST /{app_id}/uploads` needs an **app access token**
  (`<app_id>|<app_secret>`), not the system-user token. With the system-user
  token it answers the misleading `(#100) Tried accessing nonexisting field
  (uploads)`, which reads like a wrong URL and is actually a permissions
  answer.
- The upload is two calls: open a session, then `POST /{session_id}` with
  `Authorization: OAuth <app token>` and `file_offset: 0` and the raw bytes,
  which returns `{"h": <handle>}`.

Submitted 2026-09-15, all three `PENDING`. **The env switch is deliberately
not done until they read APPROVED** — repointing
`WHATSAPP_PHONE_NUMBER_ID` while templates are pending would break day
announcements, and the old number is still serving correctly.

### Still to do, once the templates approve

1. Register the number for Cloud API with a 6-digit PIN if it is not already —
   `status: CONNECTED` suggests it is; confirm before switching.
2. `WHATSAPP_PHONE_NUMBER_ID` → `1301526083048758`,
   `WHATSAPP_WABA_ID` → `1451782100105607` in `/etc/fernscout/env`.
3. `features.whatsapp.number` → `+44 7862 131685` in
   `/var/lib/fernscout/config.json`.
4. Restart, then send one real announcement and one inbound message before
   touching the old number.

### A credential to rotate

The owner pasted the live app secret into a chat transcript while setting this
up. It was not written to any file here. **It should be rotated** in App
Dashboard → Settings → Basic, and `WHATSAPP_APP_SECRET` updated in
`/etc/fernscout/env`.

## The switch is live; delivery blocked on billing — 2026-09-16

Done: Swiss Twilio number **released** (permanently; $9/month saved, one
number left on the account). Env repointed —
`WHATSAPP_PHONE_NUMBER_ID=1301526083048758`,
`WHATSAPP_WABA_ID=1451782100105607` (the key was **absent**, not empty, so it
had to be appended). `features.whatsapp.number` → `+44 7862 131685`.
Restarted, healthy, all three templates **APPROVED** on the new WABA.

**A template send is accepted by the Graph API and then refused by Meta.**
Two distinct reasons, found only because B1809 shipped mid-debug and made the
status webhook visible:

| Error | Cause |
| --- | --- |
| `131053 Media upload error` | the test payload's header image URL 404'd — a fault in the test, not the setup |
| `131042 Business eligibility payment issue` | **the new WABA has no payment method** |

**`131042` turned out to be transient, and the diagnosis above was wrong.**
The WABA already had a valid card attached (VISA, Kontostatus *Genehmigt*).
A retry minutes later, with **nothing changed on the owner's side**,
delivered. So Meta's billing-eligibility check is eventually consistent and
lags the payment method being present.

**The honest response to `131042` is to wait and retry before touching billing
settings.** Reading it as "no payment method" sent this ticket hunting in the
wrong place; the error text names a cause that may simply not have propagated
yet.

**The template itself is proven good.** Meta reaches the billing check only
after validating the template, language, parameters and header image, so
`fernscout_day_published_v2` is approved, correctly recreated and accepted.

### Outbound is proven — 2026-09-16

A `fernscout_day_published_v2` (de) template with image header, three body
parameters and the URL button **delivered** to the owner's phone from
+44 7862 131685: two status callbacks, no `failed`. Marketing templates work
on the new number.

A passcode-format SMS also delivered from the same number
(`<code> is your Fernscout code. It expires in 30 minutes.`).

### Owner step still open

Add the owner's personal user as an admin **on WABA 1451782100105607** —
creating an asset in a portfolio does not grant it, which is why Insights
refused with *"Nur ein WABA-Admin kann Insights bestätigen"*.

Billing state could not be read from here: `primary_funding_id` and friends
answer `(#10) requires that the Business that owns this App is a Business
Solution Provider`, on both WABAs. Do not re-attempt it from the API.

### Still unproven

Inbound on the new number. No real inbound message has arrived yet — the one
webhook callback per send has been a status, never a message. Test it after
billing unblocks the send, so a single round trip proves both directions.

## Work

1. ~~Prove inbound on the GB number.~~ **Done 2026-09-15 — see below.**
2. **Run the Meta verification** on +44 7862 131685 — SMS first, voice call as
   the fallback the Swiss number never had.
3. **Register it as a second number on the existing WABA**, per B1067: run both
   in parallel, confirm the approved templates show as available to the new
   number inside WhatsApp Manager *before* decommissioning anything.
4. **Tell contacts from the old number while it still works.** There is no
   "Change Number" notification for a Cloud API number with no app presence.
   This is a people task, not a technical one, and it is the step a migration
   forgets.
5. **Deregister the personal number** — `POST /{PHONE_NUMBER_ID}/deregister`,
   with 2FA/PIN turned off on it first. Rate-limited to 10 calls per number per
   rolling 72 hours; exceeding it is error `133016` and a further 72-hour lock.
   Do this **before the SIM lapses**, never by letting it expire.
6. **Then revisit `features.sms.allowedPrefixes: ["+41"]`** — see below.

## What this unblocks

**B1317** — the domestic-only SMS ceiling. Twilio prices outbound SMS by
destination, not by sending number, so the GB number reaches CH $0.0769,
DE $0.112, AT $0.0979, HU $0.091, FR $0.0798, IT $0.0927 (USD). If step 1
passes, `allowedPrefixes` can widen or drop and B1317 stops being a ceiling.

It also beats the alphanumeric-sender-id plan B1067 was drifting toward, on the
ground B1067 itself identified: an alphanumeric sender **cannot receive a
reply**, which is B386's mistake in a new medium. A real mobile number can, and
the reply lands in /admin through the webhook already proven above.

## Unproven — do not write these down as facts

- **That European carriers preserve a GB long code as sender.** B1067 already
  recorded that Telenor and Magyar Telekom commonly overwrite a sender with a
  local long code; some carriers also filter foreign long codes for A2P. If the
  sender is rewritten the recipient sees an unfamiliar number and a reply goes
  nowhere. **Write every SMS so it still reads sensibly from an unrecognised
  sender** — the rule B1067 landed on, unchanged.
- **Whether Austria's 1 October 2026 sender-id registration applies.** It
  governs alphanumeric sender ids and a long code is not one, so it probably
  does not — but this was reasoned, not confirmed with Twilio.
- **Whether one number can serve both WhatsApp and SMS.** WhatsApp runs over
  data and should not consume the SMS channel, so the number should keep
  working at Twilio after Meta registers it. Steps 1–2 settle this in passing.

## The product question, for the owner

**A +44 sender on a Swiss family journal is a decision, not a detail.** The
alternative B1067 recommended — a second dedicated Swiss SIM on a real operator
at CHF 10–25/month — keeps the +41 and verifies most reliably, at the cost of a
physical SIM somebody has to hold. The GB number is $2.50/month against the
Swiss Twilio number's $9.00 and needs no hardware.

The GB number is bought and cheap enough to abandon, so this does not block
step 1. But it should be answered before step 3 makes it the number readers
see.

## Acceptance

The WhatsApp Business number this instance sends on is **not** a SIM belonging
to the owner personally; the number it is now is verified, registered on the
existing WABA with the approved templates available to it, contacts have been
told from the old number, and the personal number has been explicitly
deregistered rather than left to lapse.
