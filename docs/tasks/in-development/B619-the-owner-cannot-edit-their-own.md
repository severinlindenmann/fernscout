---
id: B619
title: The owner cannot edit their own details or their journal's name anywhere, and cannot post themselves a card
type: FEATURE
priority: high
complexity: high
area: me page, contacts, config
found: "2026-09-06T16:06:25Z"
started: "2026-09-06T16:07:02Z"
session: 46b8aec7-0279-4118-8632-da0af1a52ced
claimed: "2026-09-06T16:07:02Z"
---

# B619 — The owner cannot edit their own details or their journal's name anywhere, and cannot post themselves a card

## Why

`/{user}/me` renders a **Deine Angaben** section with an *Bearbeiten* button
that opens `ContactManage` inline — name, telephone, postal address, the
language to write in, and the three consents. It is gated on the viewer having
a contact row (`app/[user]/me/page.tsx:70`), and the owner never has one. So
the person who owns the journal is the only reader of their own page who
cannot edit anything about themselves, on a page whose whole subject is *your
access*.

Three things follow from the same gap.

**A postcard cannot be sent to the owner.** `recipientsFor` in
`lib/postcard/contacts.ts:30` is `listContacts` filtered by `wantsPostcard`
and a postable address, and `POST .../postcards` addresses cards by
`contactId`. No row, no id, no card — so the one journey an owner would use to
check the print pipeline end to end, posting one to themselves, is the one the
API cannot express.

**The journal's own name is not editable by the person who owns it.**
`PATCH /api/v1/<user>/config` writes `title` since B220, and it takes a bearer
token only, so changing a typo means holding an agent token. The owner
standing on their own page, signed in, cannot.

**And their address is the wrong thing to store in a file.** Every postal
address in this codebase is encrypted at rest (`encryptAddress`,
`CONTACTS_ENCRYPTION_KEY`) because it is somebody's home. Adding
`owner.address` to `config.json` would be the one plaintext copy, and would
need the postcard recipient list to grow a second kind of id for a recipient
who is not a contact.

So the owner gets **a contact row of their own**, and every existing
mechanism — the encrypted address, the edit form, postcards, the digests —
works for them the way it works for everybody else. Decided with the owner on
2026-09-06.

## Work

- **`POST /api/contacts/admin`, action `self`.** Cookie, owner only, which
  the route's `guard` already is. `requestContact` at the owner's own address,
  then `confirmContactFromSession` (they are signed in *as* that address —
  there is nothing left to prove and no invite mail to send, which is what
  makes this different from the `create` action beside it), then
  `approveContact`. Idempotent: a row that exists is returned, never rewritten.
- **`PATCH /api/journal`** — new, cookie, owner only, `{title?, tagline?}`
  into `setJournalProfile`. Outside `/api/v1` and taking no bearer token, the
  same shape and for the same reason as the postcard send route: this is the
  owner's own administration, not an agent's write. Its guard is its own —
  `/api/contacts/admin`'s refuses when contacts are off, and a journal's name
  has nothing to do with contacts.
- **`/{user}/me`** — the *Deine Angaben* section gains an owner branch: when
  the owner has no row, one button that makes one. Once it exists the section
  is the form everybody else already gets, unchanged. A second card carries
  the journal's name and tagline, and the owner's address **read-only**, with
  the sentence saying it is the credential that decides who can get a token
  and is changed by whoever runs the server.
- **`lib/digest/dayWhatsapp.ts`** — a contact recipient at the owner's own
  address is `free`. B614 made the owner's copy free by way of `owner.tel`;
  once the number can also live on their own row, freeness has to be decided
  by *who they are* rather than by which field the number sits in, or an owner
  who fills the form in is charged for their own message. `dayLetter.ts`
  already behaves this way, by deduplication.
- Locale strings in all three files, and `test/depersonalised.test.ts` still
  has to pass — no real name goes near `app/` or `components/`.

**Not doing:** changing `owner.email` from the page. It is the address that
decides who can obtain a write token, so a stolen year-long cookie must not be
able to move the journal to another mailbox; the form shows it and says who
changes it. A flow where the *new* address proves itself with a code and every
session and token is revoked is a task of its own — capture it.

**A decision to record rather than break.** ROADMAP decision 24 is "the
frontend has no editing UI, ever", and it is about the journal's *content*:
days, photographs, trips, and never a write token in a browser. None of that
changes here. What this adds is owner *administration* from a cookie, which
the browser has done since the contacts page approved its first guest and
since a postcard order was first sent from `/{user}/postcards/<id>`. The
comment at the top of `app/api/v1/[user]/config/route.ts` says "this is not a
settings page, and there will not be one", and after this it is wrong — amend
it, and note the amendment on the decision the way B283's is noted.

## Acceptance

- Signed in as the owner on `/{user}/me`: one button adds your details, and
  the same *Bearbeiten* form every guest gets then edits your name, telephone
  and postal address. Reloading shows what you saved.
- With a postal address and the postcard box ticked, `GET
  …/postcards/recipients` includes the owner, and a card can be proposed to
  them.
- The journal's name can be changed from that page and shows in the header
  after a reload. A title cleared to `""` is refused, not written.
- The owner's email is on the page and has no input.
- A signed-in guest gets none of it: `PATCH /api/journal` and `action: "self"`
  answer 403 for anybody but the owner, and 403 for a bearer token.
- With `wantsWhatsapp` and a number on the owner's own row, publishing a day
  sends them a message and debits nothing.
