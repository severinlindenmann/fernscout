---
id: B1751
title: An old trip that exists only as photographs on a phone has no way into a journal
type: FEATURE
priority: medium
complexity: high
area: imports, photos, helper, credits
found: "2026-09-14T19:43:33Z"
---

# B1751 — An old trip that exists only as photographs on a phone has no way into a journal

## Why

Everything this software is good at assumes the trip is happening now, or was
written up while it was fresh. The trips people most want in a journal are the
old ones, and those exist as nothing but a few hundred photographs on a phone.
There is no route from that phone into a journal. The inbox takes files
(`lib/inboxUpload.ts`) and day-assembly turns them into a day (B1595), but a
person with a folder of 2019 photographs has no door, no guide, and no idea
that the place and time they need are already sitting inside the files.

The related problem is that the person does not know where their own data is.
Google Timeline, contacts, the photo library on an iPhone versus an Android —
each is a different export, buried differently, and the answer is written down
nowhere on this site.

## Work

Two things under one roof at `/extract`.

**1. A guide.** A page with a submenu per kind of data, saying the shortest
real way to get it out: GPS history (Google Timeline), contacts, photographs
with location on iOS and on Android, bank statements for costs (B1581 is the
same problem for Revolut). Words somebody reads, kept honest — each route
tested before it is published, and dated, because these exports move.

**2. A guided import of old photographs.** The flow, as the owner described it
on 2026-09-14:

- Sign in on the phone, pick photographs — an album, or a stretch of days —
  and press upload. Bulk, hundreds of files.
- They land in **temporary storage that does not count against the journal's
  quota** (`lib/storageQuota.ts`) and is deleted automatically after ~48h.
  Throttled per account. *Decided: S3-compatible object storage with lifecycle
  rules doing the expiry.* Two things that decision must not break, and the
  build owes both: the capability is **off by default and absent, not broken,
  when disabled** (`lib/capabilities.ts`, `/api/health`), and **a fresh clone
  must be developable and testable with no provider account** — so a local
  filesystem driver with the same 48h sweep is part of this ticket, not a
  follow-up. See the concern recorded below.
- Metadata is extracted on arrival — GPS, timestamp, camera — through
  `lib/ingest/exif.ts`, the code that already does this.
- The person is then walked through what they uploaded, the way the helper's
  files pane already works: scroll the photographs, keep or drop each one, set
  what is public, guest or private, and **talk** — an open voice memo per day
  or per photograph, with example prompts ("who were you with here?", "what
  happened after this?"). Transcription exists already (B1060).
- At the end they press generate. It costs credits (`lib/credits.ts`) —
  describing everything, or describing named photographs, priced separately.
  **Nothing in the generation step is free.**
- The output is **a complete trip as a draft**. They preview it and publish it
  themselves. Publishing stays the owner-only, explicitly-consented call it is
  today; generate must never publish.

Constraints that are not negotiable here: nothing invented. A photograph with
no location gets no location, not a guess; a day the person did not talk about
gets no story. The whole point of the voice memo is that the words are theirs.

Reuse rather than rebuild: the inbox is the store, day-assembly (B1595) is the
assembler, `lib/ingest/exif.ts` is the reader, the helper is the interviewer.
If this ticket grows a second photograph pipeline, it has gone wrong.

**Blocked on B1750.** Whether the phone even keeps EXIF through an upload, how
many files survive at once, and whether a PWA can finish the upload in the
background are unanswered. Background upload is listed above as *if possible* —
if B1750 says iOS cannot, this flow is designed around a foregrounded tab and
says so to the person, rather than promising a background sync that silently
never runs.

**Concern recorded, not a blocker (2026-09-14).** AGENTS.md says no feature may
require a paid provider account to develop or test, and asks for no new vendor
requirement without measured need. Object storage was chosen deliberately, by
the owner, for the lifecycle expiry; the local-driver requirement above is what
keeps the rest of the contract true.

Security review path before merge: this accepts large uploads from the public
internet, holds them outside the quota, and spends credits.

## Acceptance

- `/extract` exists, with a working submenu per data kind, and each route in it
  has been followed by somebody end to end.
- From a phone, an owner can select a large batch of photographs, upload them,
  and see them appear as pending items with their extracted date and place.
- Temporary items do not count against the journal's quota, and an item older
  than the TTL is gone — demonstrated, not asserted.
- With the capability disabled, `/extract`'s import half is absent and
  `/api/health` explains why; the guide half either stays or is absent
  consistently, and the ticket says which.
- The guided pass lets the person keep/drop each photograph, set its
  visibility, and record a voice memo that is transcribed.
- Generate costs credits, refuses when there are none, and produces a **draft**
  trip. Nothing is published without a separate, explicit owner action.
- No field in the generated draft contains anything the person or a file did
  not supply. A photograph with no EXIF location produces a day with no
  location.
- Verified in a real browser at desktop and phone width, per AGENTS.md.

## Related

B1750 answers the phone questions this ticket rests on. B1595 is the
day-assembly it must reuse. B1581 is the same export problem for bank
statements. B1011 is the missing phone app the guide half partly substitutes
for.
