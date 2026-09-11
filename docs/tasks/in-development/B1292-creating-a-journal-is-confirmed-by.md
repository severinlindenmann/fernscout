---
id: B1292
title: Creating a journal is confirmed by nothing, and never shows the address the person just chose
type: ISSUE
priority: medium
complexity: low
area: signup
found: "2026-09-10T10:59:24Z"
started: "2026-09-11T08:26:07Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T08:26:07Z"
---

# B1292 — Creating a journal is confirmed by nothing, and never shows the address the person just chose
## Why

The wizard's create step asks eight questions, several of them explicitly
permanent — *"It cannot be changed afterwards"* for the address, and again for
the currency. Pressing **Create my journal** succeeds and the screen changes like
this:

- the card still reads **"New here? Start your own journal — an email, a name for
  it, and your first trip."**
- a new block appears below it: **"And your first trip"**, with three fields.

That is the whole of it. Nothing says the journal was made, nothing names it, and
the address the person just chose and can never change —
`fernscout.ch/test-mobile` — is not shown anywhere on the page.

A *failed* create, by contrast, prints a sentence (B1247, B1250). So the person
gets more feedback when it goes wrong than when it goes right, and the only way
to find out whether the permanent decision landed the way they meant it is to
finish the trip step and look at the room's header.

## Work

- Confirm the creation in words, and show the address as a URL the person can
  read and recognise. This is the one moment it is worth showing.
- Keep it short: the trip step is the next thing they should be doing.

## Acceptance

- After a successful create, the page says the journal exists and shows its
  address.
- The stale "Start your own journal" preamble is not still the heading over it.
