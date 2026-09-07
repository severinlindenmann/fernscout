---
id: B687
title: Photographs cannot describe themselves
type: FEATURE
priority: low
complexity: medium
area: agent, media
found: "2026-09-07T09:53:01Z"
---

# B687 — Photographs cannot describe themselves

## Why

Plan §2 and §4. A person who uploaded twelve photographs and cannot think what
to write is the blank-page case. The metadata already answers a surprising
amount of it for free — time, place, count, sequence — and this task adds the
part only a model can do: what is actually in the picture.

It is deliberately a separate, explicit, priced button. Describing every upload
automatically would spend credits nobody asked to spend and send every
photograph off the instance by default.

## Work

- `POST /api/helper/describe-photos`, cookie only, metered per ten images, the
  price on the button.
- Captions come back for review and are never written silently.
- The free metadata suggestions (time, place, distance) ship with B682 and stay
  — this only adds the paid layer above them.
- Consent (B684) has to have named photographs before any image is sent.

## Acceptance

Pressing the button on twelve photographs charges two credits, returns captions
the owner edits or discards, and never runs on upload. With the capability off
the button is absent.
