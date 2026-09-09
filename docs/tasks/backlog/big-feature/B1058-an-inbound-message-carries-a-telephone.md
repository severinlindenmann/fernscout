---
id: B1058
title: An inbound message carries a telephone number and nothing that says whose journal it is
type: FEATURE
priority: high
complexity: high
area: whatsapp, identity, onboarding
found: "2026-09-09T07:11:42Z"
---

# B1058 — An inbound message carries a telephone number and nothing that says whose journal it is

## Why

A webhook event carries `from`: a telephone number in E.164 digits. Nothing in
this codebase turns that into a journal.

The two places a number already appears are both the wrong shape for it.
`Owner.tel` (`lib/config.ts:102-125`) is *"the owner's own telephone number,
for their own free WhatsApp copy of a published day"* — a destination, never
proven, and absent from almost every journal. `contacts.postal_cipher` holds a
*reader's* number, encrypted, for postcards and announcements, and readers are
not owners.

So there are three questions and the code answers none of them:

1. **Whose journal is this?** A lookup from a proven number to a username. It
   does not exist because no number has ever been proven (B1065).
2. **What if nobody's?** A stranger messages the number. Today that is a
   signup opportunity and a spam surface at the same time, and every reply
   costs a model turn.
3. **Is a telephone number enough to write somebody's journal with?** It is
   the *only* credential WhatsApp offers. A lost phone or a swapped SIM is
   then a journal takeover, which is a weaker story than the six-digit code to
   a mailbox that every other door here uses.

Question 3 is the one that decides the shape of the other two, and it is a
person's to answer — see the question book. The honest framing: a number is
enough to *draft*, and the things that cannot be undone or that spend money
already end at a web page with a button (postcards, photobooks, credits,
deletion). That pattern was built for a different reason and happens to be
exactly the mitigation this needs.

## Work

- A binding from a proven E.164 number to one journal, normalised through
  `toE164` (`lib/whatsapp/phone.ts`) and nothing else. Where it lives depends
  on B1064; if that lands, this is a read of the same registry.
- First contact from an unknown number: decide between refusing with one
  sentence, or running the signup conversation in chat (ask for an address,
  mail a six-digit code, take it back in the chat — which proves both halves
  at once and costs nothing, since inbound opens a free window).
- A rate limit and a spend ceiling per number *before* the model is reached.
  `lib/rateLimit.ts` is per-IP and a webhook has one IP — Meta's. This needs a
  different key.
- An entry point: a `wa.me` link on the landing page and in the room, with a
  prefilled first message. Consider whether it should carry a one-time linking
  code so an owner already signed in binds their number in one tap.
- Nothing here weakens `isHelperOwner`; it satisfies B1055's resolver.

## Acceptance

A message from a bound number reaches that journal's helper and no other; a
message from an unknown number costs no model call and cannot be made to; and
a number bound to one journal cannot be bound to a second.
