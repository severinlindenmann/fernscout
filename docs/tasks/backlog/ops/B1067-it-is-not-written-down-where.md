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

## Decided — 2026-09-09

Answered by the owner, and it grew a second half.

**What the number is: a physical SIM belonging to the owner, personally — and
it will be removed in future.** That is the finding, and it turns this from a
bookkeeping ticket into a risk one. A lapsed Swiss mobile number is reassigned,
and whoever holds it next can receive WhatsApp's verification for it.

So this ticket now has two deliverables.

**1 · The succession plan, before the SIM goes.** What a number change costs
and what survives it: the WABA and its approved templates are account-level and
survive; the number a reader sees does not, and neither do existing threads.
Whether the number can be ported at all is the first question — Twilio's Swiss
mobile numbers are explicitly non-portable, so a port means a Swiss operator or
a DID provider that accepts one. Write the plan while there is no deadline.

**2 · The SMS provider, which is now blocking.** B1065 chose SMS as the proof
channel, and there is no account. Come back with two or three options, priced
per message for CH, DE, AT and HU, each confirmed to support an alphanumeric
sender id and to need no number of our own, and each with a way to develop
against it with no account. **The owner approves from that page** — do not sign
anything up.

Meta business verification: **not yet**. Nothing planned initiates a
conversation, so the 250-per-24h cap only ever binds the day announcements,
which are family-scale.

## Researched — 2026-09-09

Web research only. **Nothing here was checked against the live Meta Business
Manager or by telephoning a Swiss operator**, and several answers rest on
partner documentation (Vonage, 360dialog, Infobip, Sinch) rather than a Meta
page that could be fetched cleanly — Meta's own docs render mostly as
JavaScript. Every soft answer is marked. Verify before executing.

### The finding that changes a decision

**Business verification lives on the Meta Business Portfolio, not on the WABA
and not on the phone number.** So it is *orthogonal* to the number change and
carries forward regardless of which number ends up attached.

That matters because the question book asked whether to verify now and the
answer recorded was **not yet**, on the reasoning that nothing initiates so
the 250-per-24h cap never binds. That reasoning still holds. But it was not
the only reason to do it, and the second one is better: verifying now, while
the account is stable, removes one variable from a number migration that has
to happen anyway. **This is worth putting back in front of the owner** — see
the note at the end.

### Retiring the number: the step that must not be skipped

`POST /{PHONE_NUMBER_ID}/deregister` is an official endpoint. It removes the
number from Meta's hosted platform and makes it available for re-registration.
Rate-limited to **10 requests per number per rolling 72 hours**; exceeding it
is error `133016` and a further 72-hour lock. It cannot be used on a
"coexistence" number in simultaneous use with the consumer app.

**Deregister before the SIM lapses.** If the contract simply ends, the
registration lingers in a stale state on Meta's side until somebody else is
assigned the number and tries to register it — at which point Meta's own
account-recovery logic decides what happens to the leftover WABA linkage.
That is not a path to test with somebody's family photographs behind it. Meta
does not document how long a dangling registration survives; treat the
unknown as a reason to do the explicit thing.

Also: turn **2FA/PIN off on the old number first**. It is the most commonly
reported blocker in every migration write-up found.

### How long the number stays dangerous

No BAKOM rule sets a quarantine period — number portability is regulated
(Art. 32 FMG), recycling is each carrier's commercial policy. Figures below
are from comparison sites, **not a primary operator document**, and should be
confirmed by telephone:

| Operator | Postpaid | Prepaid |
| --- | --- | --- |
| Swisscom | ~120 days | ~180 days |
| Salt | ~6 months | ~6 months |
| Sunrise | ~12 months | ~18 months |

The low end is four months. Letting the SIM lapse and treating the number as
retired is not safe on that timescale, and the exposure is wider than
WhatsApp — a personal number is usually also a 2FA and account-recovery
factor somewhere else.

### What survives a number change, and what does not

| Survives | Does not |
| --- | --- |
| The WABA itself | The quality rating — per number, starts fresh |
| Approved templates (they are WABA-level) | The messaging tier — per number, has to be re-earned |
| Business verification (portfolio-level) | Open 24-hour windows — a new number has none |
| The opt-in records the business holds | Existing threads on contacts' phones |

The last row is a customer-facing project, not a technical one. The consumer
WhatsApp app has a "Change Number" notification that messages existing chats;
**no equivalent was found for a Cloud API number with no app presence.**
Contacts have to be told, from the old number, while it still works.

### Porting: confirmed dead ends

- **Twilio.** Confirmed from Twilio's own Switzerland guidelines: Swiss mobile
  numbers are **SMS-only and strictly non-portable**, remain the property of
  Twilio's local carrier partner, and do **not** support voice. So the number
  cannot be ported *in*, and a Twilio Swiss mobile number could not answer a
  voice verification either.
- **Telnyx.** Switzerland requires business use only, a pre-filled requirement
  group, and ~72-hour validation. Whether Telnyx issues genuine 07x *mobile*
  DIDs with voice and SMS is **unconfirmed** and needs a direct check.
- No provider was found that clearly accepts an inbound port of an existing
  Swiss mobile number into an API-driven platform. If that is a hard
  requirement it is the weakest link in the plan, and it needs a sales call
  rather than a search.

### The recommendation

**A second, dedicated Swiss mobile SIM on a low-cost business plan.** It
verifies most reliably (no A2P filtering surprises), signs up straightforwardly
for a sole trader, and costs roughly CHF 10–25 a month — **unverified, check
directly**. Register it as a *second* number on the existing WABA, run both in
parallel while telling contacts, then deregister the personal one.

The landline/VoIP alternative is real but fragile: WhatsApp does support
landline verification by voice call, and registration fails outright behind
call-blocking, certain VoIP routing, or an IVR that never reaches a human.
Extensions are not supported — the code goes to the primary number only.

### Still to verify before anything is committed

- Telephone Swisscom, Sunrise and Salt for their actual recycling policy.
- Current business-mobile pricing, from the operator's own page.
- Whether Telnyx issues Swiss mobile DIDs with voice — from their number
  search, not from documentation.
- That templates show as available to a newly registered second number inside
  WhatsApp Manager, before decommissioning the first.

### One question back to the owner

Business verification was deferred on the grounds that nothing initiates. That
reasoning is intact, but verification turns out to be portfolio-level and
therefore free of the number question entirely — so doing it now costs a
document upload and removes a variable from a migration that is coming anyway.
**Worth reopening.**

## Researched — the SMS provider, 2026-09-09

Web research. Several vendors put their real per-country price behind a login
or a JavaScript calculator; those are marked **not public** below rather than
guessed.

### The time-critical thing, first

**Austria: from 1 October 2026 an unregistered alphanumeric sender id is
silently dropped, not delivered.** RTR's registration directory opened on
1 July 2026 and entries take **14 days to activate** — so the practical filing
deadline is around **17 September 2026**, which is next week.

This is a carrier-level rule and applies to every provider equally. It is not
a reason to rush the decision, because Austria is not the launch market — but
it *is* a reason to ask any shortlisted provider, before signing up, how they
handle Austrian sender-id registration. Only `seven.io` documents the path in
its own dashboard.

Germany and Switzerland have no equivalent registry. **Hungary has no registry
and a worse problem**: Telenor and Magyar Telekom commonly overwrite an
alphanumeric sender with a numeric long code regardless of provider, so a
Hungarian recipient may see the code arrive from a number they do not
recognise. Write the message so it still reads sensibly in that case.

### The finding that matters to this codebase specifically

**An alphanumeric sender id is one-way. Everywhere. For every provider.**
There is no number behind "Fernscout" for a reply to route to; a reply either
fails, bounces, or is silently dropped with the sender never seeing an error.
Where a carrier has overwritten the id with a long code, a reply goes to an
aggregator's shared number that nobody reads.

That is B386's mistake in a different medium — a footer promising *"STOPP zum
Abbestellen"* over a channel where nothing read a reply. **So the OTP text must
not imply a reply channel.** The code, what it is for, and an instruction to
contact `agent@fernscout.ch` or the website. Nothing else.

### The shortlist

| | CH | DE | AT | HU | Test mode | Min top-up | DPA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **seven.io** | €0.075 | €0.075 | €0.075 | €0.075 | Real sandbox key, never charges | **€1** | One-click |
| **GatewayAPI** | not public | not public | not public | not public | 30-day trial, amount only via chat | none found | Published Art. 28, **EU hosting at Hetzner** |
| BudgetSMS | €0.063 | €0.051 | €0.053 | €0.056 | Validation endpoint only | none found | **None. No server location disclosed** |
| ASPSMS (CH) | ~4–7 Rp | not public | ~4 Rp | not public | Ask for test volume | ~500 credits (~€30) | Swiss DC, ISO 27001, no explicit DSG text |
| eCall (CH) | not public | not public | not public | not public | Free trial, amount unclear | none (prepaid) | **Explicit DSG + GDPR + ISO 27001:2022** |
| Twilio | $0.0769 | $0.112 | $0.0979 | $0.091 | ~100 SMS, verified numbers only | none | Yes; EU residency may be enterprise-gated |

### The recommendation, for the owner to approve

**`seven.io`.** It is the only provider whose own documentation answers all six
requirements without an account: a flat **€0.075** to all four countries, a
genuine sandbox key that never sends and never charges, a **€1** minimum
top-up rather than the €20–30 several others demand, a self-serve DPA, and a
documented path for the Austrian registration. At the 50/day ceiling that is
about €113 a month worst case and a few euros in reality — so at this volume
**price is noise and paperwork friction is the real cost**, which is what it
wins on. Its weakness: GDPR only, no named datacentre, no explicit Swiss FADP
statement.

**Runner-up: GatewayAPI**, on compliance alone — a published Art. 28 DPA,
opt-in EU hosting in Germany, ISAE 3000/3402 statements, and a mode that does
not store message content. It loses because **you cannot see a price for any
of the four countries before opening an account**.

**Do not use BudgetSMS.** Cheapest published prices, and no DPA, no disclosed
server location and no data-protection statement anywhere on the site. For a
product whose whole character is care with personal data, that is
disqualifying regardless of price.

Also ruled out: SMSAPI (€30 minimum, business-only, sender approval reportedly
up to a month), Swisscom (enterprise gate, no public pricing), ClickSend
(Hungary missing from its own alphanumeric list, SCCs only), Plivo (a possible
$1,000/month enterprise gate on the SMS product — confirm before considering),
Vonage's trial (injects `[FREE SMS DEMO, TEST MESSAGE]` into the body, so it
cannot show what a real message looks like).

**The two Swiss options are worth a second look before deciding.** `eCall` is
the only candidate with an explicit **DSG** statement rather than GDPR alone,
which is the operator's own law — and neither it nor ASPSMS publishes European
pricing. Both are a telephone call away, and a Swiss provider with a Swiss
data-protection statement may be worth more here than €0.01 a message.

### Still to confirm before signing anything

- `seven.io`'s Austrian registration path, and whether it is needed at launch.
- Whether `eCall` or ASPSMS will quote CH/DE/AT/HU, and what their DSG
  statement actually covers.
- That the chosen provider's sandbox really sends nothing, by driving it.

## Clarified — 2026-09-09, after the owner read seven.io's price page

**The ~€200/year is a dedicated inbound number, and it is an optional add-on
this design must never buy.** Recorded here because the price page shows it
next to the sending price and it will be re-discovered otherwise.

| | Price | Needed |
| --- | --- | --- |
| Sending an SMS | €0.075, pay-as-you-go | **yes** |
| "Own sender" — alphanumeric, ≤11 characters | **free** | **yes** |
| Account, subscription, monthly minimum | **none** | — |
| Dedicated inbound number | **€19.90/month + €9.90 setup** | **no** |
| Receiving an SMS on one | €0.01 | no |

€19.90 × 12 = €238.80 a year, which is the figure that caused the question.

**The reason never to buy it is not the money.** An alphanumeric sender id
**cannot receive a reply at all** — there is no number behind "Fernscout" for
one to route to, which is the same fact that forces the OTP text not to imply
a reply channel. An inbound number would be €239 a year for a mailbox nothing
in this codebase reads, which is B386's mistake bought rather than written.

If a reply channel is ever genuinely wanted, the answer is not an inbound SMS
number — it is the WhatsApp number that already exists and, after B1057, will
actually answer.

### The sandbox is real, and better than reported

Not a trial credit: **a separate API key with `Environment = Sandbox`**, made
under Developer → API Access. Requests with it never send and never touch a
paid product. That is what satisfies AGENTS.md's rule that no feature may need
a paid account to develop or test, and it means step 2 of the phase 1 plan
(the transport with nothing calling it) can be driven for real before any
money is spent.

There is also €0.50 of free credit for a new account — useful for the one
real end-to-end send, and unrelated to the sandbox.

### The running cost, honestly

One message per account for its lifetime (B1065). At one signup a day that is
**about 365 messages, roughly €27 a year, and no fixed cost at all**. The
instance ceiling of 50/day is a worst case of about CHF 3 in one day, not a
recurring commitment.

### Still to confirm

The €0.075 is seven.io's headline rate. Their own page says to *"check our
full price list by country"* for variations, so **confirm the four
destinations — CH, DE, AT, HU — on the by-country list** rather than trusting
the flat figure. It changes nothing about the recommendation at this volume,
but the plan should not carry a number nobody checked.

## Driven against a real account — 2026-09-09

The owner opened a seven.io trial account and could not get a message
delivered. Driven from the API with his key, against his own number
(the operator's own mobile), five sends. **Every one was accepted by the API and then
rejected before delivery, and refunded.**

```
2026-09-09 18:31:40  from=SMS          dlr=REJECTED  err=407001
2026-09-09 18:30:06  from=Fernscout    dlr=REJECTED  err=407001
2026-09-09 18:28:41  from=123123       dlr=REJECTED  err=407001
2026-09-09 18:27:24  from=hellooo      dlr=REJECTED  err=407001
2026-09-09 18:27:11  from=abc          dlr=REJECTED  err=407001
```

`mccmnc 22801`, latency 0.106s — an instant gateway rejection, not a carrier
timeout. **The same error for an alphanumeric sender, a numeric sender, and
seven.io's own default `SMS` sender**, so it is not the sender id.

**What rules out everything else:** an HLR lookup on the same key and the same
number **succeeds** — returns the live carrier (Swisscom, ported from
Sunrise), a valid mobile. So the key is valid, the account can spend on paid
products, the number is real and reachable, and the API is being called
correctly. Only the SMS route refuses.

`407001` is not in any public seven.io documentation that could be found.

**The conclusion, and it revises this ticket's recommendation:** the research
pass recorded seven.io as *"self-serve signup, no KYC found"*, and that is
**wrong or at least incomplete** — a fresh account cannot send an SMS to a live
Swiss mobile without something else happening first, most likely an account or
identity verification that gates SMS while leaving lookups open. That is a
normal anti-fraud posture and not a reason to reject the provider, but *"open
an account and send"* is not the story, and this ticket should not have said
it was.

**Next step is seven.io support**, with the five message ids and the fact that
HLR succeeds on the same account. Until that answer arrives, **the provider
recommendation is not confirmed** and GatewayAPI and eCall stay live options —
they may well have the same gate, which is worth asking each of them *before*
opening an account rather than after.

### What the run did confirm

- **Swiss pricing is genuinely flat.** `GET /pricing?country=CH` returns
  **€0.075 across all 16 Swiss networks**, so the headline rate is the real
  rate for CH and the "confirm the by-country list" caveat above is answered
  for Switzerland. DE, AT and HU remain unchecked.
- **A rejected message costs nothing.** The balance was refunded on every one
  of the five. That is the behaviour the ceilings in B1065 assume.
- **The sandbox is a separate API key**, not a parameter — Developer → API
  Access, Environment = Sandbox. It never sends and never touches a paid
  product.

### The encoding finding, which changes what the Hungarian message may say

Measured, not assumed — the API reports encoding and parts even on a message
it then rejects, so this cost nothing:

| Text | Encoding | Parts | Price |
| --- | --- | --- | --- |
| German OTP, ~135 chars | `gsm` | 1 | €0.075 |
| Hungarian OTP, accents stripped | `gsm` | 1 | €0.075 |
| **Hungarian OTP with real accents** | **`ucs2`** | **2** | **€0.15** |

`á í ó ú ő ű` are not in the GSM-7 alphabet, so a properly written Hungarian
message falls to UCS-2, where a part is **70 characters** rather than 160 —
and the same sentence costs double. German is unaffected: `ä ö ü ß` *are* in
GSM-7.

**The answer is not to strip the accents.** AGENTS.md is explicit that a
plausible-looking imitation of a language ships and is read by somebody whose
language it is, and a Hungarian OTP written without accents is exactly that.
**The answer is to write the Hungarian one short enough to fit a single UCS-2
part — under 70 characters.** That is comfortably achievable for a code, an
expiry and nothing else, and it means the "do not reply" sentence may have to
be dropped from the Hungarian version specifically. Decide that in B1065 with
this table in front of you.

## The 407001 cause, and a shortlist — 2026-09-09

### Why seven.io refused

Their Terms and Conditions, read verbatim from
`seven.io/en/company/terms/`:

> *"The services offered by seven.io are aimed exclusively at **traders**. By
> concluding the contract, the customer assures that he is a trader and that
> the short messages are sent as part of his business… seven.io reserves the
> right to request proofs from the customer about the correctness of his
> information, for example a **commercial register extract or a business
> registration**."*

That fits the observation exactly: **HLR is a lookup and succeeded; SMS is the
"sending as part of your business" product and was refused instantly**, for
every sender type, with the balance refunded.

**It is the strongest explanation and it is still an inference.** seven.io has
not said so, and `407001` remains undocumented. The way to settle it is one
email, and it is worth sending — **the operator may well qualify.** Fernscout
takes real money through Stripe in live mode, which is trading; and a Swiss
Einzelunternehmen is only obliged to enter the Handelsregister above CHF
100,000 turnover, so "no register extract" does not automatically mean "not a
trader". Do not abandon the best-fitting provider on an inference when a
question answers it.

### Ask these before opening any account

The reusable output of this whole episode. Get written answers **first**:

1. I am a Swiss sole trader (Einzelunternehmen) with no Handelsregister
   entry. Can I send transactional SMS with an alphanumeric sender id through
   your API?
2. Is there a contract, business documentation or manual review before the
   **first** message actually delivers, or does self-serve signup deliver
   immediately?
3. Is there a sandbox that works before I add a payment method, and does it
   exercise the real alphanumeric path to CH/DE/AT/HU carriers or only
   simulate success?
4. Typical approval time for an alphanumeric sender id in CH, DE, AT and HU,
   for under 50 messages a day?
5. Any monthly fee or minimum tied to the sender id itself, separate from the
   per-message price?
6. If I hit a rejection code, will you tell me whether it is an eligibility
   gate or a technical fault?

Question 6 is the one that would have saved this round: seven.io left a bare
`407001` to be reverse-engineered.

### The shortlist, ranked by "will this work for a Swiss individual"

| | Gate | Fixed cost | Sandbox |
| --- | --- | --- | --- |
| **ASPSMS** (Swiss, VADIAN.NET AG) | Signup asks name, company, address — **no visible register requirement**. Free test volumes granted by a human on request | None; credits never expire; **min top-up ~500 credits (~€30)** | Free test credits, pre-payment |
| **Sinch** | **Switzerland is listed as needing no sender-id pre-registration.** DE/AT/HU unconfirmed | Pay-as-you-go | **Real sandbox**, unlimited simulated sends, works before payment |
| Twilio | **Alphanumeric sender ids are blocked on trial accounts** — card first, then per-country registration (there is a help article just for Austria) | None once paid | Best-documented magic-number mode — but it cannot exercise a real alphanumeric send |
| Brevo | Not confirmed | None | Not confirmed |
| Bird | Test key instantly; production needs a payment method and a verified sender | Not confirmed | Yes, pre-payment |

**Try ASPSMS first.** Swiss, under the operator's own law, no monthly fee, and
its published signup fields do not visibly demand a register number — which is
exactly the axis seven.io failed on. **Sinch second**, for the sandbox and
because Switzerland is explicitly pre-registration-free.

**Avoid**: **Vonage** — self-serve alphanumeric registration is *"only
available for Managed Customers"* with an assigned account manager, so a
single-user account structurally cannot get there. **Textmagic** — the sender
id carries its own **~€10/month** subscription. **CM.com** — full features sit
behind €129/month tiers.

### Unverified, and worth knowing it

ASPSMS's actual approval bar for a Swiss sole trader (human-reviewed, no
public account of the outcome); Sinch's DE/AT/HU sender-id rules; Brevo's and
Bird's behaviour on the gate question specifically. GatewayAPI, Clickatell,
eCall's real signup path, LINK Mobility and MessageMedia were not researched
to a conclusion.

**At €27 a year of message spend, the cheapest next move is emailing ASPSMS
and Sinch the six questions in parallel — not another blind trial.**
