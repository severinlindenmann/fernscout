---
id: B1394
title: "A phone's own contacts cannot be handed to the upload field"
type: FEATURE
priority: medium
complexity: medium
area: the web helper, contacts
found: "2026-09-10T20:30:00Z"
---

# B1394 — A phone's own contacts cannot be handed to the upload field

## Why

The files pane already takes more than photographs: `PICKER_ACCEPT`
(`components/PhotoPicker.tsx:21`) is
`image/*,video/*,.csv,.pdf,.json,.txt,.gpx,.md`, and the pane says so — *Fotos,
Videos, ein Kontoauszug, ein Standort-Export*. A bank statement goes in as a
file and becomes costs; a Timeline export goes in and becomes a track.

Contacts are the one address book a person already has, and there is no way to
hand it over. On a phone this matters more than anywhere else: the contacts app
shares a `.vcf` to anything that will take it, and typing a name, a street and
a postcode on a phone keyboard — per recipient — is the alternative. That is
the surface where somebody would actually be sending a postcard.

It is also the wall B1393 records from the other side: the helper asks *Wen
soll die Postkarte erreichen?*, and today the answer is a form, one contact at
a time, on the settings page.

## Work

**Take `.vcf` (vCard) on the picker, and treat it as an import, not as a
write.**

- Three lists have to move together and two tests hold them: `PICKER_ACCEPT`
  and `FILE_EXTENSIONS` in `components/PhotoPicker.tsx`, and
  `INBOX_FILE_EXTENSIONS` in `lib/inbox.ts` (server-only, which is why the
  client keeps its own copy — B845). `test/agent-picker-accepts.test.ts` and
  `test/agent-picker-kinds.test.ts` fail if one is missed. A vCard is not a
  photograph, so it counts on the `files` side of the picker's own split.
- **This is `importers/`, and the kind is `contacts`.** The folder is a
  registry per kind with its own `schema.ts` naming the row, beside
  `importers/gps/` (`Fix`) and `importers/costs/` (`Payment`) — see
  `importers/README.md`. Add the kind, its row type, and a vCard parser; the
  `index.ts` listing is not optional, because a bundler cannot trace a
  directory scan.
- **It reports; it does not write.** `costs` is the precedent and the right
  one: a statement is read, a person agrees line by line, and only then does a
  route write. A vCard carries other people's names and postal addresses —
  exactly the thing an agent must never decide — so the import proposes a list
  and the person ticks who is actually a contact. Nothing is created from the
  file alone.
- **Every row lands `pending`, and the mail still goes.** `requestContact`
  files everything pending and `approveContact` refuses an unconfirmed address
  (`app/api/contacts/admin/route.ts`) — importing twenty contacts must not be a
  way past that. The honest sentence afterwards is how many rows were filed and
  that each is waiting on its own confirmation, never that they are recipients.
  If a proposal cannot say that truthfully, it is a `lib/helper/model.ts`
  check.
- **Addresses do not reach the model.** `postcard_recipients` answers with a
  name, a town and a country by design. A vCard's parsed contents must go the
  same way — parsed server-side, shown to the person, summarised to the model
  — and never into a conversation.
- The door is `POST /api/v1/<user>/import` with a `kind` and no other route
  (B671), and it reads bytes from the inbox. Follow that; do not add a second
  one. Contract work per `keep-the-contract` once the `kind` enum grows.

**Not in this ticket.** No contacts *export*, no sync, no address book UI
beyond what the import needs to show. No change to confirmation, to
`approveContact`, or to who may press send on a postcard.

## Acceptance

- On a phone, sharing a `.vcf` from the contacts app into the picker stages it,
  and it is named as a contact file rather than counted as a photograph.
- The import reports what it found — names, and which have a postal address —
  and writes nothing until the person agrees per row.
- Agreed rows appear on `/<user>/contacts` as `pending`, each with its
  confirmation mail sent, and none of them is postcard-addressable until it
  confirms.
- A vCard with no address, a malformed one, and one with twenty entries each
  behave sensibly — the last is the case that decides whether the agree step is
  usable at all.
- `npm run verify` clean, including both picker tests and the importer's own
  registry test.
