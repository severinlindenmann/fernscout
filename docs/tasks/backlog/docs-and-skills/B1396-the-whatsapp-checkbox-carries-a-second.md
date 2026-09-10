---
id: B1396
title: "The WhatsApp checkbox carries a second sentence about Meta that the form does not need"
type: DOCS
priority: low
complexity: low
area: contacts form, wording
found: "2026-09-10T20:55:00Z"
---

# B1396 — The WhatsApp checkbox carries a second sentence about Meta that the form does not need

## Why

The WhatsApp tick on the contact form reads:

> Schickt mir eine WhatsApp, wenn ein neuer Tag online geht
> *Ist eine Reise geschlossen, enthält die Nachricht trotzdem ihr Foto — das
> Foto erreicht den WhatsApp-Betreiber, bevor es dich erreicht.*

The owner has decided the second line comes off. It is one more paragraph in a
form whose job is a handful of ticks, and the person reading it is choosing how
to be told about a new day, not auditing a message pipeline.

`contact.wantsWhatsappHint` — `site/locales/en.json:198`, `de.json:198`,
`hu.json` — rendered at `components/ContactForm.tsx:479` and
`components/ContactManage.tsx:364`.

**What it was for, so the decision is made with it in view.** B372 added it:
the WhatsApp announcement uses a template with an image header, so
`uploadMedia` (`lib/whatsapp/cloud.ts`) hands the day's first photograph to
Meta before the message goes — including for a `private` trip. Mail answered
the same question differently (B345 inlines the bytes so a closed trip's
picture never leaves the gate), and B372's finding was that the difference was
written only in the source. The checkbox was one of the three places it put the
sentence.

That reasoning is not wrong, and removing the line does not make it wrong — it
moves where it is said. Worth deciding explicitly rather than by omission:
`/agent.md` and `docs/` also carry it from B372, and the person who most needs
it is arguably the **owner switching the capability on**, not the reader
ticking a box. Keeping it there and dropping it here is the middle option; the
owner's instruction is to take it off the form, and that is what this ticket
asks for.

## Work

- Remove the hint from both forms — `ContactForm.tsx:479` and
  `ContactManage.tsx:364`.
- Delete `contact.wantsWhatsappHint` from all three locale files and
  regenerate the union with `npm run i18n:keys`. `knip` will flag it if it is
  left behind unreferenced.
- Leave B372's other two homes alone unless the owner says otherwise: the
  `/agent.md` line and whatever `docs/` carries. Deleting the checkbox line is
  the ask; deleting the record is not.
- Consider whether the owner-facing capability page or `/api/health` should
  carry it instead, and capture that separately rather than widening this.

## Acceptance

- The WhatsApp tick shows one line on `/<user>/me` and on the guestbook form.
- `npm run verify` clean — `test/locales.test.ts` (no orphan key in de/hu) and
  `knip` (nothing unreferenced) both included.
