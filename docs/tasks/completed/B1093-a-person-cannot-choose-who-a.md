---
id: B1093
title: A person cannot choose who a photobook is posted to
type: FEATURE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-09T15:59:14Z"
started: "2026-09-09T17:31:12Z"
merged: "2026-09-09T17:59:23Z"
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

## What was built, and what it turned up

**Valid on revalidation.** `page.tsx:137` fell through to "nobody has proposed
printing this book to anybody yet" for a *built* book, and
`PhotobookPrintPanel` took a single fixed `recipient` prop with no way to
change it.

Built as designed, with one addition the Why did not anticipate: the rule about
who may receive a book now lives in `lib/photobook/propose.ts`, called by both
the agent route and the owner's own. Duplicating that check into a second route
is how the two doors come to disagree, and it is the check that stops a book
being addressed to somebody who never asked this journal for post.

`self` is decided by matching the contact's address against the journal's
`owner.email`, which meant `eligible()` had to return the email it already
had. It is used for that and rendered nowhere — the list is still a name and a
town, and `test/photobook-recipients.test.ts` now asserts no address or email
field rides along.

**Two pre-existing bugs were found by looking at the page, neither of which any
test could see, because every test mocks the printer:**

- **B1125 — the quote was malformed and always refused.** Gelato requires
  `products[0].itemReferenceId` on `orders:quote`; it was never sent, so every
  quote came back `BAD_REQUEST`, which the order page renders as "the printer
  could not be reached". The print panel could therefore never appear for
  anybody, which is almost certainly why B911 records this flow as never run.
  **Fixed in this branch**, because B1093's own acceptance — reaching the panel
  — cannot be demonstrated at all while it stands, and the fix is one field.
  Recorded as its own ticket rather than folded in silently.
- **B1126 — the order sends a country name where Gelato wants an ISO code.**
  Not fixed here: it does not block this ticket's acceptance, and it is a
  separate defect in `printOrder`/`providers.ts`. Pressing the button gets as
  far as the printer and is refused there. The refund path was verified in the
  same run and is correct.

## Acceptance

- An owner with a built book and at least one postable contact can reach the
  existing print panel without an agent having touched the order.
  **Shown** — `/example/photobooks/eae6122c-…`, a book and a journal this
  branch did not write, with no proposal on the order: the panel renders with
  the owner preselected and the quote taken for them.
  `/tmp/b1093-shots/…-1280.png`, and `…-390.png` for the phone.
- A journal with no postable contact gets a sentence saying so rather than an
  empty control.
  **Partly shown** — the branch is `recipients.length === 0 →
  photobook.print.noRecipients`, exercised by the type checker and read in the
  code, but not photographed: the local journal has contacts and removing them
  to stage the empty case would be a fixture written for its own verification.
  Worth a person's eye on a journal that genuinely has none.
- `npm run verify`. **Green** — 470 files, 6337 tests, knip clean.

Also demonstrated, beyond the written acceptance:

- Choosing the other contact re-quotes for *them* and opens the disclosure by
  itself, since the selection is no longer the owner —
  `/tmp/b1093-shots-other/…-1280.png`.
- Pressing the button runs the whole path: propose → claim → spend → submit.
  Gelato refused the submit for B1126's reason, and the refund was correct —
  `-17200` then `+17200` in `credit_ledger`, balance whole, page back at
  `?print=refused`.
