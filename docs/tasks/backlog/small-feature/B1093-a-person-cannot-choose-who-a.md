---
id: B1093
title: A person cannot choose who a photobook is posted to
type: FEATURE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-09T15:59:14Z"
---

# B1093 — A person cannot choose who a photobook is posted to

## Why

The photobook page can only offer to print a book that an agent has already
addressed. `app/[user]/photobooks/[id]/page.tsx:84` reads
`order.payload.print`, and `:103` looks the recipient up by `print.contactId`;
`components/PhotobookPrintPanel.tsx` takes `recipient` as a fixed prop — a
name, a city and a country to show, with nothing to change it. So the panel is
a confirmation of a decision made elsewhere, and the only thing that can make
that decision is `POST /api/v1/<user>/photobooks/<id>/print` via an agent.

That is a different shape from postcards, where the whole point of B434 is that
the owner sees the cards, the recipients, the cost and their balance on one
page and presses the button. Here the button exists but the page before it does
not, so an owner with a finished book and a contact who wants post has no route
from one to the other without an agent writing the proposal for them.

It is also why B911 has never been run end to end by a person: every live test
so far has had an agent write `payload.print` first.

The pieces are all present — `bookRecipients` already answers with the
contacts who are `active` and postable, and the send route already refuses a
bearer token. What is missing is the choosing.

## Work

- On the photobook page, when there is no `payload.print` yet and the book is
  built, offer the postable recipients from `bookRecipients` and let the owner
  pick one. Selecting writes the same proposal the agent route writes, so the
  existing panel — quote, cost, balance, one button — is what comes next
  unchanged.
- Cookie session only, like the send route. An agent token renders no page
  here anyway.
- Say why the list is empty when it is: no contacts, none active, none with an
  address. An empty list with no sentence is the failure this ticket is about,
  one level in.
- Not doing: entering an address by hand. Addresses reach this journal by a
  person asking for post (B434), and a box on this page would be a way around
  that.

## Acceptance

- An owner with a built book and at least one postable contact can reach the
  existing print panel without an agent having touched the order.
- A journal with no postable contact gets a sentence saying so rather than an
  empty control.
- `npm run verify`.
