---
id: B1074
title: A location pin and a shared contact card arrive as text and become nothing
type: FEATURE
priority: medium
complexity: medium
area: whatsapp, gps, contacts
found: "2026-09-09T10:49:17Z"
---

# B1074 — A location pin and a shared contact card arrive as text and become nothing

## Why

WhatsApp carries two message types this journal has an obvious use for and no
route to read.

**A location pin** is a latitude and a longitude a person tapped to say *we
were here*. It is a measurement — the same category as a GPS fix, which
`importers/gps/` writes as it reads precisely because *"a coordinate is a
measurement, and there is nothing about it to decide"*. A day already carries
coordinates. One tap is a better door onto them than any form.

**A shared contact card** carries a name, a telephone number and often a
postal address — most of what `lib/contacts` wants when somebody is invited to
read a journal or receive a postcard.

The trap in the second, and it is the whole reason this is not a small
ticket: **a contact card is not consent.** `lib/contacts/index.ts` requires
the person themselves to confirm their own address, `wants_whatsapp` and
`wants_postcard` are separate columns because Meta's policy needs
channel-specific consent, and `approveContact` is the only thing in the
codebase that creates a grant. Somebody forwarding their sister's card has not
asked their sister anything.

So the two arrive together and end differently, for the same reason `gps` and
`costs` end differently at `POST /api/v1/<user>/import`.

## Work

- **A pin writes.** Resolve which day, set its coordinates, say which day it
  went on. No model judgement required and none should be introduced.
- **A card proposes.** It pre-fills an invitation — name, address, and the
  number if there is one — and the existing invite and double opt-in flow runs
  unchanged. The reply says an invitation is ready, never that somebody has
  been added.
- Nothing here may write a postal address into `postal_cipher` on a stranger's
  behalf. That is the person's own to give.
- A card with no email cannot be invited at all today; say so rather than
  half-creating a row.

Not doing: bulk contact import, or a pin becoming a trip's track (that is
`gps/` and it has its own door).

## Acceptance

A pin sets a day's coordinates and the reply names the day; a shared card
produces an invitation waiting to be sent and no grant, no contact row marked
active, and no consent recorded.
