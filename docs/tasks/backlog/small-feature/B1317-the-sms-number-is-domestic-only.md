---
id: B1317
title: The SMS number is domestic-only - a non-Swiss number cannot receive a code or a send
type: FEATURE
priority: low
complexity: medium
area: sms, twilio
found: "2026-09-10T15:35:25Z"
---

# B1317 — The SMS number is domestic-only - a non-Swiss number cannot receive a code or a send

## Why

The instance's Twilio number (+41 76 601 46 49) carries Twilio's sender
restriction "can send/receive SMS to domestic numbers only": it reaches +41
recipients and nobody else. A Swiss SIM roaming abroad still works (the
restriction is on the country code, not the location); a +49 or +33 number
never does. B1316 makes this honest — `features.sms.allowedPrefixes:
["+41"]` refuses a non-Swiss recipient with `sms_unreachable` and points at
WhatsApp — but the ceiling itself stands, and the owner decided
(2026-09-10): Swiss clients are enough for now, capture the rest for later.

## Work

When international SMS is wanted, one of (each with its own Twilio
compliance step):

- a number without the domestic restriction, or a second number from
  another country, added as a further `from` the transport picks by
  recipient prefix;
- an alphanumeric sender ID for send-only traffic (no inbound, and not
  accepted by every country);
- or leave SMS Swiss-only forever and let WhatsApp stay the international
  channel — which is the status quo and may simply be the answer.

Then widen or drop `allowedPrefixes` in the deployed config.

## Acceptance

A person the owner cares about with a non-+41 number can receive a signup
code by SMS — or this ticket is closed `wontDo` with WhatsApp named as the
international channel.
