---
id: B1063
title: The imprint does not say that a message sent to the WhatsApp number is read, stored and sent to Meta
type: DOCS
priority: high
complexity: low
area: legal, privacy, whatsapp
found: "2026-09-09T07:11:45Z"
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
