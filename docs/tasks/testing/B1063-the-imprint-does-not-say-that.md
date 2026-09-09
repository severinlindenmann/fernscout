---
id: B1063
title: The imprint does not say that a message sent to the WhatsApp number is read, stored and sent to Meta
type: DOCS
priority: high
complexity: low
area: legal, privacy, whatsapp
found: "2026-09-09T07:11:45Z"
started: "2026-09-09T20:27:44Z"
merged: "2026-09-09T21:01:24Z"
---

# B1063 — The imprint does not say that a message sent to the WhatsApp number is read, stored and sent to Meta

## Why

`site/legal/en.md:131` already carries one row for Meta:

```
| Meta Platforms Ireland (WhatsApp Cloud API) | A reader asked to hear about
  new days by WhatsApp | Their phone number, and the message |
```

That is true of the outbound announcement B365 ships, and it is the whole of
what the imprint says. An inbound channel makes three of the page's current
statements wrong at once:

- **"Only the owner of a journal talks to the helper."** The helper's own
  bullet says so, and it is what makes storing conversations defensible. If a
  guest or a stranger can message the number, it stops being true.
- **The data categories.** Inbound means message *content*, photographs,
  documents and voice recordings arriving through Meta and being stored here.
  Postal addresses and phone numbers are named; message content and media from
  a messenger are not.
- **Who is a processor for what.** Meta is a processor for the Cloud API and
  its own controller for platform integrity, and using the Business Platform
  at all means the WhatsApp Business Terms and Meta's data processing terms
  apply. A Swiss instance is under the revised FADP and, for European readers,
  the GDPR; both want the notice to name the recipient, the purpose, the legal
  basis and the retention.

`lib/legal.ts` is explicit that this file is the operator's own statement
about their own company, and that a fork inheriting it would be publishing
somebody else's imprint. So this ticket is words a person signs off, not
generated copy.

## Work

- Amend the external-services table: a second row (or a widened one) for the
  inbound direction, naming what Meta receives and what it hands over.
- Add a bullet under "What is stored, and why" for messages, media and voice
  notes arriving by messenger, with how long each is kept — and check that
  against what is actually true (transcripts are kept, audio provably is not;
  inbox files sit until a day claims them).
- Correct the helper bullet if non-owners can reach the channel.
- Both `en.md` and `de.md`, in real German. Hungarian if the instance offers
  it — and if you cannot write the language, say so and leave the ticket short
  of done. That is the same rule as inventing a day, one level down.
- Whether a DPA with Meta needs signing, and whether a record of processing
  activities is owed, is the operator's to answer. Put the question in the
  ticket rather than deciding it.

Not doing: a cookie banner, a consent wall, or anything that changes what the
software does. This is the page catching up with it.

## Acceptance

The imprint describes the inbound channel accurately enough that a reader can
tell what happens to a photograph they send, and nothing on the page is still
claiming only the owner talks to the helper if that has stopped being true.

## Researched — 2026-09-09

Web research, **not legal advice**, and one item below genuinely needs a Swiss
data-protection lawyer rather than a checklist tick. Sources are Meta's own
legal pages, Anthropic's and Deepgram's published terms, and Swiss/EU
commentary; cited in the run notes.

### Meta's contracts are click-through, and there is nothing to sign

For a business using the Cloud API directly with no BSP, the stack is: the
**WhatsApp Business Terms of Service**, the **Meta Platform Terms**, the
**Cloud API Hosting Terms**, the **WhatsApp Business Data Processing Terms**,
and the **Business Data Transfer Addendum** — the last incorporated *into* the
DPT by reference rather than being a separate contract.

**All accepted by click-through** when the WABA is registered. No separate DPA
is procured with Meta and none is available at this size. So the page should
cite the Data Processing Terms and the Data Transfer Addendum **by name**,
rather than saying "we have a DPA with Meta", which a reader cannot check.

### Two Meta roles, not one — and the page currently implies one

- **Meta Platforms Ireland is a processor** of message content, on the
  business's instruction. Meta states plainly that Cloud API messages are not
  used to target ads.
- **Meta also acts as its own controller**, separately and narrowly, for
  platform safety, integrity and fraud detection, and for the account data
  Business Suite holds about the business.

These are two different legal relationships and the notice should carry them
as two lines. Link to WhatsApp's own end-user privacy policy for the second
rather than restating it.

The US leg closes through the **Swiss–US Data Privacy Framework** (Federal
Council adequacy, in force 15 September 2024) and its EU equivalent — so the
accurate sentence is "Meta Ireland as processor, with the US transfer covered
by the DPF", not "Meta Ireland" alone.

### The legal basis is contract, not consent — and that is worth getting right

- **Inbound messages** processed to write the journal: **Art. 6(1)(b), contract
  performance.** The person messaged us asking for the service. Consent is not
  required and is the weaker basis, because it is revocable mid-service.
- **Outbound template announcements**: consent, as today. Unchanged.
- **Sending content to Anthropic and Deepgram**: rides on the same 6(1)(b) —
  a sub-processor fulfilling the contracted service is a controller decision,
  not a new purpose — **provided** it is disclosed and covered by an Art. 28
  DPA.
- **Voice notes are not biometric special-category data.** A recording becomes
  Art. 9 data only when the processing aims to *identify* somebody by their
  voice. Transcription is not that. Worth stating so nobody over-complies and
  builds a consent wall that is not owed. The existing `speech` consent scope
  stays useful as transparency; it is not a legal necessity.

Under Swiss law, **Art. 19 revDSG** wants the controller's identity, the
purposes, the recipients, and — since data goes abroad — the destination and
the safeguard.

### The gap that is nobody's consent to give

Photographs and documents forwarded through WhatsApp carry **other people's**
data: a travel companion in a picture, a name on a bank statement. That person
agreed to nothing. This is a real gap common to every "send your document to an
AI" product, and the proportionate answer is a line on the page and a line in
the channel's own copy: only send what you have the right to share.

### Bank statements and location are not "sensitive" — and still need care

Neither financial data nor location is a special category under GDPR Art. 9 or
revDSG Art. 5(c). But a bank statement can incidentally reveal data that *is*
— a payment to a church, a union, a clinic. The mitigation already exists and
is architectural: statements are **reported and agreed merchant by merchant**,
never auto-categorised, and `lib/gps/store.ts` is reachable from no route. The
page should name both as safeguards rather than treating "not special
category" as "nothing to say".

**The WhatsApp ingest path must route through the same functions**, not a
shortcut. That is a note for B1057 as much as for this page.

### What has to be done, in order

**Actively executed, not merely published:**

1. Verify Meta's Data Processing Terms and Transfer Addendum are actually
   accepted for this app — verify, do not assume.
2. Verify Anthropic's commercial terms are accepted for the API organisation
   in use; the DPA and its SCCs come with them by reference.
3. **Email `security@deepgram.com` for a DPA.** Unlike Anthropic's, it is
   reported not to be click-through. This is the one sub-processor agreement
   that needs an action.
4. **Set `mip_opt_out=true` on every Deepgram call** — that is B1076, it is a
   live gap today, and it should not wait for this ticket.
5. **Get a lawyer's answer on whether an Art. 27 GDPR representative is
   needed.** A Swiss operator with German, Austrian and Hungarian users and no
   EU establishment needs one unless the processing is occasional and
   low-risk. That carve-out is arguable for a journal at this scale and gets
   weaker because bank statements and location history are in scope. **This is
   the item that needs a professional.**

**Published on the page:**

6. Three sub-processor rows: Meta Ireland / WhatsApp LLC (US, DPF), Anthropic
   (US, DPA and SCCs), Deepgram (EU endpoint if adopted, else US, DPA).
7. Meta's processor role and its independent-controller role, as two lines.
8. The legal bases, and that voice notes are transcribed rather than
   voiceprinted.
9. **An AI disclosure in the channel's first message**, with a route to a
   human (`agent@fernscout.ch`). Required by Meta's policy update and
   separately likely by the EU AI Act's transparency duty. See B1077.
10. The "only send what you have the right to share" line.

**Configured:**

11. Opt-out keyword handling ahead of the model — B1062, and B1077 raises it
    from courtesy to condition of shipping.
12. A one-page internal processing register. Art. 12 revDSG exempts private
    organisations under 250 employees whose processing is **low risk**, and
    this instance almost certainly qualifies on headcount — but "low risk" is
    the prong that bank statements and location history make arguable.
    Writing the page is cheap; relying on an exemption you might not have is
    not.
