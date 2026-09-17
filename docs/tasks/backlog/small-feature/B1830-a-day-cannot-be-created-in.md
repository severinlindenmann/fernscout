---
id: B1830
title: A day cannot be created in the browser
type: FEATURE
priority: medium
complexity: medium
area: studio, days, ui
found: "2026-09-17T05:11:55Z"
---

# B1830 — A day cannot be created in the browser

## Why

`components/EditDay.tsx` edits a day that already exists. Nothing creates one.
The only ways to start a day are to talk to `/agent` or to send something to
WhatsApp — so the most common thing a person does to a travel journal is the
one thing the website cannot do.

This is the **main flow** of the studio (B1829) and the first real proof the
skeleton works for something that is not a file upload.

Plan: `docs/plans/2026-09-17-the-studio.md`.

## Work

The *Add a day* flow, on B1829's skeleton.

Gather, one thing per screen: which trip and which date; photographs; what
happened; where. Reuse what exists rather than rebuilding — `PhotoPicker` for
the gallery, the staged inbox in `lib/inbox.ts` for files already sent, the day
schema in `lib/api/v2/schemas/day.ts`.

The date and trip can usually be proposed rather than asked: `getCurrentTrip()`
already derives the current trip from its dates, and photograph EXIF carries the
day. Propose, show the reasoning, let it be changed.

Preview shows the day as it will read. Decide is the check-answers screen. The
final button makes a **draft** — publishing stays a separate, explicit act, and
the copy must not imply the day goes live.

**Never invent content.** An empty title is correct; a generated one is not.
Any AI assistance (prose from a voice note, photograph descriptions) is offered,
priced and declinable, exactly as in B1820, and the day is complete and
publishable without it.

If a day already exists for the chosen date, say so and offer to open it in the
edit flow (B1831) rather than silently creating a second one.

## Acceptance

- A day can be created from nothing, in a browser, with no agent — trip, date,
  text, photographs, location.
- It lands as a draft, and publishing remains a separate decision.
- Choosing a date that already has a day offers the existing day instead.
- No field is ever filled with invented content.
- Real en/de/hu strings; `npm run i18n:keys` clean.
- Verified in a real browser at desktop and phone width.
- `npm run verify` passes.
