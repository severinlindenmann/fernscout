---
id: B1471
title: The messenger number is printed for a person to dial in a form only a machine can use
type: ISSUE
priority: medium
complexity: low
area: agent docs, whatsapp
found: "2026-09-11T14:29:07Z"
started: "2026-09-13T06:55:45Z"
merged: "2026-09-13T06:59:58Z"
---

# B1471 — The messenger number is printed for a person to dial in a form only a machine can use

## Why

Found by reading B1070's new section on the deployed instance, minutes after it
merged. Live on fernscout.ch right now, `/documentation.txt` says:

> **A messenger, at 41782172646.** Text it and a model turn answers…

That is not a number anybody can dial, paste into a contact, or recognise as
Swiss. `whatsappDisplayNumber()` (`lib/whatsapp/settings.ts:41`) returns
`toE164(configured)`, and `toE164` (`lib/whatsapp/phone.ts:31-49`) deliberately
returns **digits with no `+`** — a normalised machine form, which is exactly what
its other callers want: `wa.me/41782172646` is a correct URL, and
`lib/phoneVerify/inboundLink.ts:63` re-normalises through it for the same reason.

So the fault is not in `toE164`. It is that **B1070's prose is the first place
this value is printed as a number for a person to read**, rather than handed to a
link or a button. `components/AgentDoor.tsx:191` and every other caller pass it
to `WhatsAppButton`; the landing page adds its own `+`.

The function's name is the trap. `whatsappDisplayNumber` reads as "the number,
formatted for display", and it is the opposite — the number formatted for a URL.
Anybody reaching for it to print will make this mistake again.

## Work

Two halves, and the second is the one that matters:

- Print it readably where a person reads it — at minimum a leading `+`, better
  grouped as `+41 78 217 26 46`.
- **Then make the next person unable to repeat it.** Either rename
  `whatsappDisplayNumber` to say what it returns (`whatsappE164`,
  `whatsappNumberForUrl`), or give it a sibling that formats for reading and
  leave the existing one to the links. A name that lies is a defect that
  regenerates.

Check every other place a number reaches prose rather than an `href`, since this
one was found by accident rather than by looking.

## Acceptance

- `/documentation.txt` prints the messenger number in a form a person can dial.
- No function whose name promises a display form returns a URL form.
- `npm run verify` clean.

## Revalidated — 2026-09-13

Still valid on current `main`: `lib/api/documentation.ts` prints the result of
`whatsappDisplayNumber()`, which is bare E.164 digits despite its display name.
The same helper is used by URL builders, so the machine form needs an explicit
URL name and a separate human-readable formatter.

## Implemented

The machine value is now named `whatsappNumberForUrl`, while documentation uses
`whatsappNumberForDisplay`, which adds the dialling `+`. URL builders retain the
bare E.164 value; `/documentation.txt` now prints the readable form.

## Verification

- Focused WhatsApp settings tests pass, including URL/display forms.
- Build, typecheck, lint, and knip pass; existing warnings only.
