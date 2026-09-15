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
