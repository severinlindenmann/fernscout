---
id: B747
title: The legal page does not name Anthropic or Deepgram
type: DOCS
priority: high
complexity: low
area: legal
found: "2026-09-07T13:10:00Z"
started: "2026-09-07T12:55:01Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T12:55:01Z"
---

# B747 — The legal page does not name Anthropic or Deepgram

## Why

`site/legal/en.md` and `site/legal/de.md` carry an **External services** table
that ends with the sentence *"That is the whole list. There is nobody else."*

That sentence is now false. Two providers receive personal data and neither is
named:

- **Anthropic** — `lib/helper/model.ts`. Receives what the person typed or
  said, plus the handful of facts their day already carries (date, place,
  country, photograph count and times) and, for `describePhotos`,
  **the photographs themselves**. Three call sites: `writeDay`,
  `describePhotos`, `routeAsk`.
- **Deepgram** — `lib/helper/transcribe.ts`. Receives **the raw audio of
  somebody's voice**, which is the most personal thing this product has ever
  been handed. B686 shipped it.

A privacy page that names Meta, Stannp, Gelato, Proton, Open-Meteo and the ECB
and then omits the two that receive a voice recording and a photograph is worse
than one that named nobody — the closing sentence turns an omission into a
claim.

## Work

Add both rows to the table in `site/legal/en.md` and `site/legal/de.md`, in the
same three-column shape as the rows already there.

Say the thing that is actually true of both and of nothing else in that table:
**they are reached only when somebody uses `/agent`**, the web helper. A reader
of a journal never causes a request to either, and an owner who writes through
their own agent never does either. That is a narrower "off unless switched on"
than the rows above it, and it is the sentence a reader wants.

Say what is *not* sent, because for these two it is the reassuring half and it
is verifiable in the code: no location history, no contacts, no addresses, and
nothing is used to train a model.

Note the dry-run case for Deepgram, the way B492's note does for the print
providers: on an instance running the `dry-run` backend nothing leaves the
machine at all. `speechBackend()` is the switch.

Note that **the audio is never stored** — `lib/helper/transcribe.ts` writes no
file and `test/helper-transcribe.test.ts` asserts it.

Not doing: the consent panel's own wording, which is B744; the provider-name
recording, which is B743.

## Acceptance

- `/legal` in English and in German each name Anthropic and Deepgram, with
  what each receives and when.
- The "that is the whole list" sentence is true again.
- The German page says the same things as the English one, not a subset.
