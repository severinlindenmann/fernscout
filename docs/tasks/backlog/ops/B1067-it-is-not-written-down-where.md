---
id: B1067
title: It is not written down where this instance's telephone number comes from, or what one message costs
type: OPS
priority: high
complexity: low
area: whatsapp, meta, provider, cost
found: "2026-09-09T07:11:56Z"
---

# B1067 — It is not written down where this instance's telephone number comes from, or what one message costs

## Why

Two separate questions get asked as one, and conflating them is what makes the
answer sound hard.

**Where does the WhatsApp Business number come from?** It already came from
somewhere. B403 records it: **+41 78 217 26 46**, display name Fernscout,
VERIFIED, quality GREEN, phone number id `1253568101181150`, WABA
`1043886595223059`, currency EUR, `account_review_status: APPROVED`, business
verification **not_verified** (so 250 business-initiated conversations per
24 hours, which is irrelevant at family scale). What is *not* written down
anywhere is what that number physically is — a SIM in a drawer, a contract, a
VoIP DID — and therefore what happens when it needs to receive a verification
call again, what it costs per month, and who is billed. That is this ticket.

**Where does an SMS to a user come from?** Nowhere yet, and it needs no number
of ours at all. Sending transactional SMS is a provider account and an
alphanumeric sender id; Switzerland and most of Europe accept one without
registration. Buying a number is only necessary to *receive*.

And the question underneath both, asked in the brief: **can a VPS activate an
eSIM?** No. An eSIM profile is downloaded by a modem; a VPS has no cellular
radio, and no amount of cloud eSIM-management tooling changes that — those
platforms provision profiles *to* devices. The workable substitutes, if a
number that receives SMS is ever genuinely needed: a VoIP/DID provider with an
SMS API (Twilio's Swiss mobile numbers are SMS-only, non-portable and
business-use only; Telnyx requires a regulatory bundle and refuses private
use), or a 4G dongle on hardware somebody controls with a small relay. Neither
is needed for anything currently planned, which is the finding worth
recording.

## Work

This is an engagement, not a diff. The deliverable is a page and some
follow-up tickets.

- Establish and write down what +41 78 217 26 46 actually is, what it costs,
  and how a Meta re-verification would be answered today. If the answer is "a
  SIM in a phone in a drawer", that is a fine answer and it needs writing down
  before the phone is lost.
- Decide whether business verification is worth doing. It lifts 250 to 1,000
  and rising, and it is what gets a display name approved. Probably not yet.
- Price one signup honestly, end to end, for each of the three proof channels
  in B1065, in rappen, for a Swiss and a German number.
- If SMS is chosen: pick a provider, check it does not require a number of our
  own, confirm alphanumeric sender ids for CH/DE/AT/HU, and note the per-message
  price for each. Confirm there is a way to develop against it with no account.
- Confirm what the app secret and verify token for the inbound webhook are and
  where they live, since B1057 needs both.

## Acceptance

One page in `docs/providers/` that answers, for somebody who has never seen
this instance: what the number is, what it costs, what one verification costs,
and which provider was chosen for SMS or why none was.
