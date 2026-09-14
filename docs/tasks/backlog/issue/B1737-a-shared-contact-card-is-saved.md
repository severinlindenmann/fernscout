---
id: B1737
title: A shared contact card is saved and then denied - nothing tells the model it is waiting
type: ISSUE
priority: high
complexity: medium
area: whatsapp, helper
found: "2026-09-14T14:50:34Z"
---

# B1737 — A shared contact card is saved and then denied

## Why

Live, on `severin`, 2026-09-14 12:02 UTC. A WhatsApp contact card arrived and
was handled correctly: `handleContactCard` wrote
`inbox/contact/55564b49ecf3-andreas-lindenmann.vcf` and answered
`wa.contactSaved` — "Erhalten — gespeichert. Sag mir Bescheid, wenn ich sie als
Gast einladen soll."

Twenty-three seconds later the owner asked to add that person to a trip. The
model answered **"Ich habe keinen Zugriff auf deine Kontakte von außerhalb des
Journals"** — and then, when told the contact had been shared, repeated it. The
owner ended up retyping the name and email by hand, into a chat that was
already holding both on disk.

Nothing is lying; nothing is connected. The model has no way to know a contact
is waiting:

- `lib/helper/server.ts:filesForRoom` builds the pane from
  `[...staged.media, ...staged.files]`. The flat `contact` and `location`
  buckets are dropped, so the card is not in the files pane either (only
  day-scoped ones survive, via `dayInboxRoomFiles`).
- `describeSelection` only describes what is *selected*, and on WhatsApp there
  is no pane to select in.
- `invite_contact` (`lib/helper/tools/areas/files.ts`) exists and does exactly
  what was wanted, but nothing in the turn's context hints that it would find
  anything, so the model never reaches for it.

So the one door B1074 deliberately built — a card lands in the inbox, inviting
is a deliberate press — has no handle on it. The promise in `wa.contactSaved`
("tell me when I should invite them") is one the next turn cannot keep.

## Work

- Include the flat `contact` and `location` buckets in `filesForRoom` so a
  shared card is at least visible on the web.
- Give the turn a short standing line naming what is waiting in the inbox by
  kind — the same shape as `describeSelection`'s trailing sentence, but about
  what is *there* rather than what is picked. A contact card's name is enough;
  no email, phone or address belongs in the prompt.
- Check `trip_people` and `invite_guest` can take a waiting contact as their
  subject, not only typed-out details.

## Acceptance

- After a contact card arrives on WhatsApp, asking "add him to <trip>" in the
  next turn resolves to that card without the owner retyping anything.
- The card appears in `/agent`'s files pane.
- A test asserts the waiting-inbox line names a staged contact and carries no
  email, phone or address.
