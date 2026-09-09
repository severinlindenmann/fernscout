---
id: B1062
title: There is still no way out of the WhatsApp channel from inside WhatsApp
type: FEATURE
priority: high
complexity: medium
area: whatsapp, opt-out, contacts
found: "2026-09-09T07:11:44Z"
---

# B1062 — There is still no way out of the WhatsApp channel from inside WhatsApp

## Why

B386 was closed `wontDo` — *"the three approved templates work and a recipient
can opt out in the app"* — and the reasoning was honest at the time: the
footer promising *"STOPP zum Abbestellen"* had been removed, so the system was
no longer lying. What it still did not do was give anybody a way out.

The three things that exist and why each is not enough are written in B386 and
have not changed: the manage link only ever appears in a *mail* footer, so a
reader who gave a number and no address never sees one; blocking the number
works instantly but leaves `wants_whatsapp = 1`, so every future publish still
tries and is still billed; and Meta's own affordance is invisible to
`lib/contacts`.

**The reason it was not fixed was that nothing read an inbound message.** Once
B1057 lands, that reason is gone, and this becomes a small ticket rather than
a design problem. It should be reopened when it does — and it belongs to the
inbound channel's first release, not a later one, because the moment the
number starts holding conversations, people will reply to announcements
expecting to be heard.

## Work

- Read `STOPP` / `STOP` / `ABBESTELLEN` / a Hungarian equivalent from an
  inbound message and set `wants_whatsapp = 0` for that number's contact rows,
  through `lib/contacts` and never with a direct write.
- Confirm it in one sentence, in the language the contact is recorded with.
- Decide whether it stops announcements only, or the conversational channel
  too. They are different things to the person sending the word — someone who
  writes their journal by WhatsApp and wants the family announcements to stop
  must not silence their own door.
- Once a word works, the footer B386 removed may come back. Do not restore it
  until it does.
- Supersede or close B386 with a pointer to this, rather than leaving a
  `wontDo` that has stopped being true.

## Acceptance

A contact who replies STOPP receives one confirming sentence and no further
announcement, and `wants_whatsapp` is `0` in the row — checked in the
database, not inferred from the absence of a message.

## Decided — 2026-09-09

Answered by the owner, and the answer is cheaper than this ticket proposed.

**Who sent the word decides what happens, and neither branch writes to
`contacts`.**

- **A guest or reader writes STOP** → reply with their own manage link, which
  is the mechanism that already unsubscribes properly (`unsubscribeUrlFor`).
  No direct write to `wants_whatsapp`, no second implementation of a
  preference. B386's actual complaint was that the manage link only ever
  appeared in a *mail* footer; this puts it where a WhatsApp-only reader can
  reach it.
- **An owner or a buddy writes stop** → **ignore it.** They are mid
  conversation and "stop" is a word in a sentence. Silencing somebody's own
  writing channel because they used a common verb is the false positive this
  branch exists to avoid.

That removes the "announcements or everything?" question entirely: a reader
has only announcements to stop, and an owner is not stopping anything.

B386 can be superseded by this once it lands.
