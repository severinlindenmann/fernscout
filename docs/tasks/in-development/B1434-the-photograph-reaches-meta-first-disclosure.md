---
id: B1434
title: The photograph-reaches-Meta-first disclosure has no owner-facing home after B1396
type: DOCS
priority: low
complexity: low
area: capabilities, whatsapp
found: "2026-09-11T09:44:20Z"
started: "2026-09-11T14:10:09Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T14:10:09Z"
---

# B1434 — The photograph-reaches-Meta-first disclosure has no owner-facing home after B1396

## Why

B1396 removed `contact.wantsWhatsappHint` — *"Ist eine Reise geschlossen,
enthält die Nachricht trotzdem ihr Foto — das Foto erreicht den
WhatsApp-Betreiber, bevor es dich erreicht"* — from both places a reader
ticks the WhatsApp box (`components/ContactForm.tsx`,
`components/ContactManage.tsx`), on the owner's explicit instruction: a form
whose job is a handful of ticks does not need a paragraph about a message
pipeline.

That leaves the fact stated nowhere a form-filling reader will ever see it.
B372's reasoning for writing it down in the first place still holds:
`uploadMedia` (`lib/whatsapp/cloud.ts`) hands a day's first photograph to
Meta before the announcement is sent — including for a `private` trip, which
mail (B345) deliberately does not do, by inlining the bytes instead. The
difference used to be written only in the source; B372 was the fix, and this
is that fix losing one of its three homes. The other two — the `/agent.md`
line and whatever `docs/` carries — were left alone on purpose (B1396's own
work section says so) and still say it, but neither reaches a reader
ticking the box, and neither reaches the owner switching the capability on.

## Work

Give the disclosure an owner-facing home, since AGENTS.md's own read of
B1396 is that the owner switching WhatsApp on is arguably the person who
most needs it, not the reader ticking a box on a form. Candidates worth
weighing rather than assuming:

- The capabilities page (wherever an owner turns `whatsapp` on) — a line
  beside the switch, read once rather than per reader.
- `/api/health`, which already documents capability behaviour for an
  operator or an agent checking on it.

Whichever is chosen, write the sentence once and point everything else at
it, the same discipline `AGENTS.md` asks for everywhere else — a fact in two
places disagrees with itself within a month.

Built, 2026-09-11, per the owner's decision (not the /api/health candidate):
a new line in `app/[user]/account/AccountPageContent.tsx`, inside the
WhatsApp row of the channel-cost list, rendered only when
`payment.channels.whatsapp` is on — read once by the owner switching the
channel, as the ticket's own first candidate proposed. New locale key
`me.whatsappPhotoDisclosure` in `site/locales/{en,de,hu}.json`
("A day's first photograph reaches WhatsApp's operator before it reaches a
reader — true for every trip, private ones included, because the message
template requires an image."), `npm run i18n:keys` run. Explicitly did not
add it to the "what this journal sends out" consent list (that is about the
model, not WhatsApp delivery) or to `/api/health`.

## Acceptance

- An owner switching `whatsapp` on sees, on the page or screen that switches
  it, that a day's first photograph reaches Meta before it reaches a
  private-trip reader — the same fact B372 put on the checkbox and B1396
  took off it.
- `npm run verify` clean.
