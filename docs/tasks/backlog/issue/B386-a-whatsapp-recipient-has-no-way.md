---
id: B386
title: A WhatsApp recipient has no way to stop the messages from inside WhatsApp
type: ISSUE
priority: high
complexity: medium
area: lib/whatsapp, contacts, opt-out
found: "2026-09-05T00:15:00Z"
---

# B386 — A WhatsApp recipient has no way to stop the messages from inside WhatsApp

## Why

B365's template carried a footer reading *"Fernscout · STOPP zum Abbestellen"*
(and *"Reply STOP to unsubscribe"* in English). **Nothing in this codebase
reads an inbound message.** There is no webhook route, no subscription to the
`messages` field, and B365's own scope note says it plainly: "Nothing here
reads a message; this is one-directional announcement only."

So the footer was a promise the system could not keep, printed on a message
sent to somebody's family. Someone replying STOPP would have been ignored,
concluded they were being ignored deliberately, and reached for the one
control that does work — reporting the number. A report is what gets a
business number banned, which takes the channel down for every reader at
once. The owner caught it before the templates were approved; they have been
deleted and recreated without the footer.

That removes the lie. **It does not give anybody a way out**, which is the
actual issue.

What exists today, and why each is not enough:

- **The `manage` link** (`manageUrl`, `unsubscribeUrlFor`) unsubscribes
  properly and is the right mechanism — but it only ever appears in a *mail*
  footer. A reader who opted into WhatsApp and never gave an email, or who
  turned the digest off, never sees one.
- **Blocking the number in WhatsApp** works and is instant, but it is the
  reader punishing the sender rather than a preference being recorded:
  `wants_whatsapp` stays `1`, every future publish still tries, and every
  attempt is still billed.
- **Meta's own "stop promotions" affordance** on marketing templates is
  outside our control and invisible to `lib/contacts`.

## Work

Decide between two shapes, and the choice is the ticket:

1. **A link, no inbound.** Put a manage URL in the template — either as a
   second URL button or in the body. Cheap, needs no webhook, and reuses the
   unsubscribe that already works. Costs a button slot, and Meta permits only
   two.
2. **Inbound webhooks.** Subscribe to `messages`, match STOP/STOPP/ABMELDEN,
   clear `wants_whatsapp`. Honest, matches what people actually type, and is a
   much larger surface: a public endpoint, signature verification
   (`X-Hub-Signature-256`), replay handling, and a new capability to keep off
   by default.

Option 1 first, in all three languages. Option 2 is its own ticket if it is
ever wanted.

Either way: **say what the opt-out is wherever consent is asked** — the
guestbook checkbox, the manage page, and the click-to-chat page all currently
say nothing about how to stop.

## Acceptance

- No shipped copy claims a reply does anything, in any language.
- A person who gets a WhatsApp announcement can reach a working unsubscribe
  without needing an email from the same journal.
- Using it clears `wants_whatsapp`, so the next publish does not try or bill.
