---
id: B1737
title: A shared contact card is saved and then denied - nothing tells the model it is waiting
type: ISSUE
priority: high
complexity: medium
area: whatsapp, helper
found: "2026-09-14T14:50:34Z"
started: "2026-09-14T15:50:55Z"
session: 47321abb-ce05-46ca-8dfe-58c5b70fa908
claimed: "2026-09-14T15:50:55Z"
---

# B1737 — A shared contact card is saved and then denied

## Why

**Valid**, revalidated 2026-09-14 against the code on disk:
`lib/helper/server.ts:filesForRoom` built its list from
`[...staged.media, ...staged.files]` with the flat `contact` and `location`
buckets dropped, while `dayInboxRoomFiles` two functions above already carried
all four. Nothing but `describeSelection` ever put an inbox file into a turn,
and that needs a pane to select in.

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

## Work — as built

- `filesForRoom` now includes the flat `contact` and `location` buckets.
- `describeWaiting` (`lib/helper/server.ts`, beside `describeSelection`) is
  the standing line, appended to the turn's last user message inside
  `answerInThread` rather than by a route — which is the only way both doors
  get it, since `/ask` composes its own selection line and WhatsApp composes
  nothing. It names contact cards and their ids, counts everything else, and
  carries no email, phone or address.
- `trip_people` gained a `contact` argument. Its `propose` reads the staged
  card **server-side** and fills only what the writer left blank, so the
  address lands in the proposal's own visible field and never in a prompt —
  the pattern `invite_contact`'s route already set.
- `readVCard` moved the two FN/EMAIL regexes out of
  `app/api/helper/[user]/invite-contact/route.ts` into `lib/whatsapp/vcard.ts`,
  beside the escaping they undo, so both readers derive an address from the
  same bytes the same way.
- `invite_guest` needed nothing: `invite_contact` is already its
  card-shaped sibling, and B1736 now delivers the link it returns.

## Acceptance

- After a contact card arrives, asking to add that person to a trip resolves
  to the card without the owner retyping anything —
  `test/helper-waiting-inbox.test.ts`, "trip_people reads the address off the
  card instead of asking for it again", plus the two cases beside it (what the
  writer typed wins; a card with no address still refuses rather than
  proposing a press that would fail).
- The card appears in `/agent`'s files pane — checked in a browser against the
  demo journal at 1280 and 390, before and after staging one card:
  `/tmp/b1737-shots/agent-before-*.png` shows the pane with nothing in it,
  `agent-after-*.png` shows the row under "Other" with its contact icon, and
  `agent-after.json` has the filename in `innerText`.
- The waiting line names a staged contact and carries no email, phone or
  address — asserted directly, including the absence of both the address and
  the phone number.

## Found on the way

- **B1739** — the browser check turned up a hydration mismatch on every inbox
  file row (`toLocaleDateString` with no locale, server ICU vs browser). Not
  this branch's: the row is shared by all kinds and the line is untouched
  here. It was invisible locally only because the demo journal's inbox is
  empty. Captured, not absorbed.
- The prompt ceiling (`test/helper-thread.test.ts`) bound at +26 tokens and
  was raised to 8550 in its own commit, with the paragraph that test asks for.
