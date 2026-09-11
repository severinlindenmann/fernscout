---
id: B1399
title: "The helper tells an owner who has just saved their own contact to go and save a contact"
type: ISSUE
priority: high
complexity: medium
area: the web helper, postcards, contacts
found: "2026-09-10T21:15:00Z"
started: "2026-09-11T08:26:08Z"
merged: "2026-09-11T09:55:08Z"
---

# B1399 — The helper tells an owner who has just saved their own contact to go and save a contact

## Why

The owner used the "add me" button on `/<user>/contacts`, came back, and asked
for a postcard again:

> Gefunden: Windig an der Praia da Rocha, 24. Juni. Der Tag hat Fotos. Um eine
> Postkarte zu entwerfen, brauchst du einen Postkartenempfänger — **speichere
> einen Kontakt auf deiner Einstellungsseite**, dann machen wir weiter.

They had. The instruction is to repeat the step they just completed, so the
loop has no exit.

**Why the row does not count.** `eligible()` in `lib/postcard/contacts.ts:33-48`
requires three things of a contact before it can be an envelope:

- `status === "active"` — the row is approved and the address confirmed,
- `wantsPostcard` — that consent ticked,
- `isPostable(postalAddress)` — enough of a street to print.

The owner-adds-themselves action (`app/api/contacts/admin/route.ts:250-275`)
deliberately files the row `pending`, with `EMPTY_ADDRESS`, and every consent
`false`. Each of those is right on its own — a typed address is not a proven
one, and a row existing is not somebody asking for post. Together they mean the
button whose whole purpose is *make me a recipient* produces a row that fails
all three gates at once, and nothing tells the person that.

**The helper cannot tell the two cases apart.** `postcard_recipients` calls
`postcardCandidates`, which returns only eligible rows, so "no contacts at all"
and "a contact three ticks short" are the same empty array. The sentence it
then produces is the one for the first case, said to somebody in the second.
It is not a lie the model invented — it is the only thing the tool's answer
supports.

## Work

**Give the tool something to distinguish with.** `postcard_recipients` should
be able to say *there are contacts, and here is what each still needs*: not
active yet, no address, postcard not ticked. Names and towns only, never a
street — the line at `lib/postcard/contacts.ts:80-88` does not move.

**Then the sentence can be true**, and it should name the actual next step —
confirm the mail, tick "wants a postcard", fill in an address — rather than
"save a contact". Whether that becomes a `lib/helper/model.ts` check depends on
whether the model can still say the wrong thing once the data is honest; a
claim that somebody *is* a recipient when no eligible row exists is the
check-shaped version.

**Consider fixing the button too, which is the shorter road.** The owner
pressing "add me" on their own contacts page has already proved that address
(they are signed in as it) and is stating their own intent. Whether their row
should therefore land `active` with `wantsPostcard` ticked — leaving only the
address to fill — is a decision worth taking deliberately rather than
inheriting from the public form's defaults. If it changes, say why in the code:
the public form's conservatism exists for strangers, and the owner is not one.
An address still has to be typed; nothing here invents one.

**Pairs with B1393**, which gives the helper a tool to add the contact at the
point it asks, and with B1395, where a buddy has no route to an address at all.
All three are the same flow failing at different steps.

## Acceptance

- With a `pending`, address-less owner row: the helper says what is actually
  missing and where, and does not say "save a contact".
- After the row is confirmed, an address filled and the postcard consent
  ticked, the same conversation offers that recipient.
- With genuinely no contacts, the current sentence is still what appears.
- No street, postcode or house number ever reaches the model —
  `test/postcard-orders.test.ts` and the `postcardCandidates` shape stay as
  they are.
- `npm run verify` clean; `keep-the-contract` if a documented route's shape
  changed.
