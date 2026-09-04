---
id: B372
title: A private trip's photograph is handed to Meta, and nothing a reader or owner sees says so
type: DOCS
priority: medium
complexity: low
area: docs, agent guide, lib/whatsapp
found: "2026-09-04T21:14:00Z"
---

# B372 — A private trip's photograph is handed to Meta, and nothing a reader or owner sees says so

## Why

B365's announcement uses a template with an image header, which means
`uploadMedia` sends the day's first photograph to Meta before the message
goes — including for a trip whose `visibility` is `private`.

This is a deliberate choice the owner made when the feature was designed, and
it is defensible: the alternative (a `link` Meta's servers fetch) would have
required a publicly reachable URL to a gated photograph, which is worse. B345
faced the same question for mail and answered it differently — it inlines the
bytes into the message precisely so a private trip's picture never leaves the
gate — so the two channels now differ on a privacy property and only one of
them has the reasoning written down.

The gap is where it is written. `lib/whatsapp/cloud.ts`'s `uploadMedia` doc
comment explains it to somebody reading the source; **nothing a person sees
does.** Not `/agent.md`, which is what an agent reads before offering to send
one. Not `docs/`. Not the guestbook checkbox, where a reader consents to
"message me on WhatsApp" without being told that consenting also means their
host's photographs of a closed trip reach Meta.

A reader cannot make that trade if nobody states it, and an owner switching
the capability on has no way to discover it short of reading the client.

## Work

- Say it in `lib/api/documentation.ts`, in the WhatsApp section, alongside the
  three differences from mail already listed there — an agent offering this
  should be able to say why it is not the same as a letter.
- Say it in `docs/` wherever the capability is described for an operator.
- Consider whether the guestbook and manage-page checkbox need a line under
  them, the way `contact.telHint` sits under the phone field. Probably yes for
  a journal with any `private` trip, and this is the part worth thinking about
  rather than just writing.
- **Not** changing the behaviour. The design decision stands; this is about
  it being findable.

## Acceptance

- `/agent.md` states that the photograph is uploaded to Meta and that this is
  true for closed trips too.
- An operator reading the WhatsApp docs learns it without opening
  `lib/whatsapp/`.
