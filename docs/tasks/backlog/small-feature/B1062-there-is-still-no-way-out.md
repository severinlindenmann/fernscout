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
