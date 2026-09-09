---
id: B1183
title: Whether an EU Art. 27 representative is owed is a lawyer's question nobody has asked
type: OPS
priority: medium
complexity: low
area: legal, privacy
found: "2026-09-09T20:49:57Z"
---

# B1183 — Whether an EU Art. 27 representative is owed is a lawyer's question nobody has asked

## Why

B1063 wrote the imprint's description of the inbound WhatsApp channel — text,
photographs, documents and voice notes now arriving from Meta, transcribed by
Deepgram, stored in the journal's inbox and with helper conversations. That
ticket's own research (see its Researched section, item 5) found a real open
question it deliberately left unanswered on the page: whether this instance
owes the EU a GDPR Art. 27 representative.

A Swiss operator with no EU establishment needs one unless its processing of
EU residents' data is "occasional" and "not on a large scale" and does not
involve special-category data. The carve-out is arguable for a journal at this
scale, and gets weaker now that bank statements (costs import) and location
history (GPS import, track rendering) are in scope alongside German, Austrian
and Hungarian readers. This is a judgement call a lawyer makes, not a checklist
an agent ticks — the ticket explicitly declined to decide it on the imprint
page itself (`site/legal/en.md`, `site/legal/de.md`).

## Work

Get a Swiss/EU data-protection lawyer's opinion on whether
`FERNSCOUT_ADMIN_EMAIL`'s operator needs to appoint an Art. 27 EU
representative, given: no EU establishment, users in Germany/Austria/Hungary,
and processing that includes bank-statement line items and GPS location
history (even though neither is stored as declared "special category" data).
If one is owed, appoint one and add a row for them to `site/legal/en.md` and
`site/legal/de.md` alongside the existing operator contact. If not owed,
record the reasoning so a future ticket does not reopen the question from
scratch.

## Acceptance

A lawyer's answer exists (in this ticket's file, or linked from it), and if a
representative is required, `site/legal/en.md` and `site/legal/de.md` name
them.
