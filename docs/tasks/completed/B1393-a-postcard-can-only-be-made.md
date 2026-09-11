---
id: B1393
title: "A postcard can only be made from a photograph already on a day, and the helper cannot add the recipient it just asked for"
type: FEATURE
priority: high
complexity: medium
area: the web helper, postcards
found: "2026-09-10T20:20:00Z"
started: "2026-09-11T08:26:08Z"
merged: "2026-09-11T09:55:07Z"
---

# B1393 — A postcard can only be made from a photograph already on a day, and the helper cannot add the recipient it just asked for

## Why

Observed in the room, with a photograph selected in the files pane:

> **Du:** erstelle mir eine postkarte
> *[the trips are listed]* Meinst du Algarve 2026? … Und: du hast noch keine
> Postkartenempfänger eingespeichert. Wen soll die Postkarte erreichen?
>
> **Du:** ah kann ich zuerst mich als Kontakt erfassen
> *Das kann ich von hier aus nicht. Postkartenempfänger trägst du auf deiner
> Einstellungsseite ein …*

Two separate walls in one flow, and the person had already picked the
photograph before either of them.

**1. A postcard is locked to a day's gallery.** `propose_postcards`
(`lib/helper/tools/areas/printed.ts:144`) takes `DAY_ARGS`, calls `resolveDay`,
and reads the photograph out of `entry.gallery` — `args.photo` is matched
against the gallery's own `src` values (`:191-196`). So a photograph must be on
a published-or-draft day of a trip before it can go on a card. A file staged in
the inbox — the thing the person had just selected, and the thing the files
pane exists to select — cannot become a postcard at all, and neither can a
photograph that belongs to no journey. Hence the helper's first move: guess a
trip, guess a day, from a sentence that named neither.

Nothing below the tool requires this. A card is one image, a message, a
signature and recipients; the day is where the picture is *found*, not
something the printer needs. `lib/postcard/orders.ts` is where to confirm the
real floor before widening.

**2. The helper asks for a recipient and cannot take the answer.** It ends the
turn with *Wen soll die Postkarte erreichen?* — and when the person says "me",
it stops. There is no `add_contact` tool in `lib/helper/tools/areas/` at all
(`readers.ts` has invites, `printed.ts` has `postcard_recipients`, which only
lists).

What makes this worse than a missing feature: the exact thing asked for is
**already one button**, and needs no new data. `app/api/contacts/admin/route.ts:250-275`
has an owner-adds-themselves action that reads the name and address out of the
journal's own `config.json`, files the row with `EMPTY_ADDRESS` and every
consent off. The helper knows it is talking to the owner. It is refusing a
press it could propose, in the middle of a flow it started.

The advice it gives is at least true — the contacts page really does take a
contact — but the flow is over, and the person came back with *"why can I not
update my personal contact"*, which is the right question.

**Seen in the same transcript, and worth confirming separately.** After the
refusal, a `read_day` answer rendered as *"Der Tag … hat das hier stehen:"*
followed by a quote block that appeared to carry the helper's own sentence
inside it — *"Aber: Kontakte erfasst du auf deiner Einstellungsseite, nicht
hier."* — as though the day's own text now said that. There is no locale key
for that sentence, so the wrapper is the model's prose rather than a template.
If it reproduces, capture it: a quote block that mixes the model's words into
somebody's day is the same class of harm `lib/helper/model.ts`'s net exists for.
Do not fold it into this ticket's work.

## Work

**Let a postcard start from a photograph, wherever it is.**

- Accept a staged inbox file as the picture — the ids `inbox` already returns,
  the same ones `attach_files` and `discard_file` take. A card built this way
  belongs to no trip and no day, and the tool's day arguments become optional
  rather than required.
- Keep the existing day route working unchanged: "the photo from the pass day"
  is still the sentence most people say.
- Check what `lib/postcard/orders.ts` and the print provider actually need from
  a trip before assuming the tool's `trip`/`slug` fields can just be dropped —
  if an order row genuinely wants a trip, decide whether a trip-less order is a
  new shape or a nullable column, and say which in the code.
- The photograph must reach print resolution. A staged original is usually
  larger than a gallery derivative, so this is likely easier rather than
  harder, but confirm it rather than assuming.

**Let the helper add a contact, at the point it asks.**

- An `add_contact` tool, proposing rather than writing: fields on screen, a
  press, the same shape as every other write. Route it at the existing
  owner-side action — do not add a second way to create a contact row.
- "Add me" is the case to make one press: the name and address come from
  `config.json`, and the row is created `pending` with consents off, exactly as
  the button does today. Anything else it must not invent — an address typed
  from a conversation is not something an agent decides (AGENTS.md), and
  `requestContact` files everything `pending` for that reason.
- **The confirmation step does not move.** A row is `pending` until the
  address confirms, and `approveContact` still refuses an unconfirmed one. So
  the helper's honest sentence is "a mail is on its way", never "you are now a
  recipient" — the same discipline as deleting and as sending. If a proposal
  cannot say that truthfully, that is a `lib/helper/model.ts` check, not looser
  copy.
- Addresses still never reach the model: `postcard_recipients` answers with a
  name, a town and a country, and cards are addressed by `contactId`. Nothing
  here changes that.

**Not in this ticket.** No change to what sending a postcard costs or to who
may press send — that stays the owner's own page with their cookie
(`lib/postcard/send.ts`, B434). No change to `approveContact`. Nothing here
lets an agent post a card.

## Acceptance

- With one photograph staged and no day involved: *erstelle mir eine
  Postkarte* reaches a proposal carrying that photograph, and the resulting
  order opens on `/<user>/postcards/<id>` with the picture on it. Driven in a
  browser (`test-with-personas` or `test-in-a-browser`).
- The existing day-photograph route still works, from the same sentence as
  before.
- *kann ich mich zuerst als Kontakt erfassen* reaches a proposal, one press
  files the row, and the helper says a mail is waiting rather than that the
  contact is ready.
- After confirming that mail, the same conversation can name that recipient
  and finish the card.
- `npm run verify` clean; `keep-the-contract` run if any `/api/v1` route
  changed shape.
