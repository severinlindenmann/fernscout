---
id: B1394
title: "A phone's own contacts cannot be handed to the upload field"
type: FEATURE
priority: medium
complexity: medium
area: the web helper, contacts
found: "2026-09-10T20:30:00Z"
started: "2026-09-11T10:53:44Z"
merged: "2026-09-11T18:35:31Z"
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

## Back to in-development, 2026-09-11

Built and merged, then returned here rather than reviewed as done. The parse
and the write shipped correctly separated — the route writes only the rows it
is given — but **no surface a person actually ticks was built**, so the third
and fifth acceptance lines above are unmet.

That is not a detail of this ticket, it is the reason its option was chosen:
the alternative was rejected precisely because under it an unintended contact
is already a pending row and a confirmation mail has already reached that
stranger before anybody reviewed anything. A vCard is somebody's whole address
book, and the protection currently exists in the shape of a route rather than
in anybody's hands.

Remaining work is the agree-per-row surface and nothing else. The twenty-entry
case in the acceptance list is the one that decides whether it is usable.


## Decision, 2026-09-11 — the agree surface is a card in the conversation

Asked, and chosen over a page on `/contacts` and over asking name by name.

The helper shows what it found as a proposal card — the names, and which of them
carry a postal address — with a tick per row and one button. It reuses
`ConfirmPanel`, matches the shape every other decision in the room already has,
and does not take somebody out of the conversation they are in the middle of.

The alternative that was rejected for a stated reason: asking one name at a time
turns a twenty-entry vCard into twenty questions, and the twenty-entry case is
the one this ticket's own acceptance says decides whether the flow is usable at
all.

Nothing about the route changes — it already writes only the rows it is given.
This builds the thing that gives it rows.

## Built, 2026-09-11 — the agree card

The missing surface is a card in the conversation, on the `import_contacts`
tool (`lib/helper/tools/areas/files.ts`, alongside `attach_files` and
`discard_file` — it reads whichever `.vcf` is staged, or the ticked one when
more than one is waiting).

- **`ProposalField` grew a `checkbox` field** (`lib/helper/blocks.ts`), with
  its own `label` (raw, never run through `t()` — it is somebody's name) and
  `detail` (a short subtitle, "already a contact of this journal"). Every
  other field still names itself through `agent.slot.<name>`; a checkbox row
  never did and could not, since twenty rows would need twenty translation
  keys.
- **`ProposalView` (`components/HelperAsk.tsx`) draws checkbox fields as their
  own scrollable list**, separate from the ordinary two-column grid of typed
  fields — `max-h-72 overflow-y-auto`, so twenty rows scroll inside the card
  rather than pushing everything below it off screen — with a select-all /
  select-none pair above the list when there is more than one row. This is
  the "reuse ConfirmPanel, match the shape every other decision already has"
  the decision above asked for, applied literally to the room's existing
  proposal card rather than to a bespoke `<ConfirmPanel>` instance: the card
  already is the room's one confirmation shape (sentence, fields, one button,
  "leave it"), and `import_contacts` is not destructive, so it does not need
  `ConfirmPanel`'s own second-press gate — that stays reserved for
  `destroy`-kind proposals per B1391.
- **The write is `POST /api/helper/<user>/contacts/import`**
  (`app/api/helper/[user]/contacts/import/route.ts`), cookie-only, owner-only,
  outside `/api/v1`. The card's rows travel as one `fixed` field
  (`vcard_rows`, a JSON array, resolved server-side and never retyped by the
  model) plus one `sel_<n>` checkbox per row; the route zips the two back
  together, keeps only what is ticked, and hands the result to
  `importContactRows` (`lib/contacts/importRows.ts`) — the loop
  `POST /api/v1/<user>/contacts/import` already ran, pulled out so a row
  filed from the card and one filed by an agent over the API land exactly the
  same way: `pending`, its own confirmation mail, never pre-approved.
- **A row already known to this journal says so.** `propose` reads
  `listContacts` once and marks a checkbox's `detail` when the vCard's email
  matches an existing contact's, rather than offering it as new.
- **The three acceptance cases:**
  - *No address at all* — a vCard with only `FN`/`N` and no `EMAIL`/`TEL`
    parses (a name is enough to be "sane"), but nothing can become a contact
    without an email, so the tool refuses in words
    (`agent.tool.contactsImportNoEmail`) rather than offering an empty card.
  - *Malformed* — no `BEGIN:VCARD` at all fails the importer's own parse and
    the tool refuses (`agent.tool.contactsImportUnreadable`).
  - *Twenty entries* — the card scrolls, select-all/none makes ticking or
    clearing all twenty one tap, and each row still shows its own name and
    (where applicable) whether it is already known.
- **Every string is en/de/hu**, real German and Hungarian, `npm run
  i18n:keys` run.
- `test/helper-routes.test.ts`, `test/helper-tool-areas.test.ts`,
  `test/helper-proposal-arguments.test.ts` and `test/helper-thread.test.ts`
  updated for the new route/tool (counts, the arguments-alone press, and the
  token ceiling — the tool's own `describe` stayed short on purpose: the
  ceiling test failed at anything longer and B930's rule is to cut rather
  than raise it).

`npm run verify` clean: 534 files, 6989 passing, 4 skipped, knip clean.

Not done here: no ADR (postal address) parsing — the vCard importer
(`importers/contacts/vcard.ts`) only ever read `FN`/`N`, `EMAIL` and `TEL`,
by design (B1394's original Work section), so "which of them carry a postal
address" in this ticket's Decision section is read as "which carry contact
info at all" (an email, required to become a contact) — the card does not
show a postal-address indicator because there is no postal address to show
one of.
