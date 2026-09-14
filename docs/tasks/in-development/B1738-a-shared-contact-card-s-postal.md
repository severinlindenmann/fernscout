---
id: B1738
title: A shared contact card's postal address is dropped by the inbound parser
type: ISSUE
priority: medium
complexity: low
area: whatsapp
found: "2026-09-14T14:50:35Z"
started: "2026-09-14T15:50:55Z"
session: 47321abb-ce05-46ca-8dfe-58c5b70fa908
claimed: "2026-09-14T15:50:55Z"
---

# B1738 — A shared contact card's postal address is dropped

## Why

`lib/whatsapp/inbound.ts`'s `MetaMessage.contacts` declares only
`name.formatted_name`, `phones[]` and `emails[]`. Meta's contacts message also
carries `addresses[]` (street, city, state, zip, country, type), `org` and
`birthday`. None of it is read, so `toVCard` cannot write it and the staged
`.vcf` holds `FN`, `TEL`, `EMAIL` and nothing else.

Found live on `severin` 2026-09-14: the owner shared a card believing they had
handed over an address, an email and a phone number. The stored card was 108
bytes and the address was not in it. Nothing said so — `wa.contactSaved` says
"received, saved", which reads as *all of it* saved.

This matters beyond tidiness: a postal address is exactly what a postcard
recipient needs, and `propose_postcards` may only address somebody already on
the list. Silently discarding the one field that flow is short of is the
opposite of the file's own rule that nothing here is invented — nothing is
invented, but something real is thrown away.

## Work

- Add `addresses[]` (and `org`, if it is free) to the parsed shape in
  `inbound.ts`, defensively — every sub-field optional.
- Emit `ADR` in `toVCard` per RFC 6350's seven components, through the existing
  `escapeVCardValue`. Confirm `unescapeVCardValue`'s reader in
  `app/api/helper/[user]/invite-contact/route.ts` is unaffected by a field it
  does not read.
- The vCard is staged bytes, not a contact row: no address may reach a contact
  record or a conversation without the usual press.

## Acceptance

- A webhook fixture carrying a contacts message with `addresses[]` stages a
  `.vcf` containing a correctly escaped `ADR` line.
- A card with no address stages exactly the bytes it stages today.
