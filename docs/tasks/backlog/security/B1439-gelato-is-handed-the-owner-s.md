---
id: B1439
title: Gelato is handed the owner's email address and can write to them directly
type: SECURITY
priority: high
complexity: low
area: photobook, gelato, privacy
found: "2026-09-11T10:31:22Z"
---

# B1439 — Gelato is handed the owner's email address and can write to them directly

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`lib/photobook/print.ts:207`:

```ts
const email = getUser(owner)?.owner.email ?? "";
```

That address is put in the `to` block of every order submitted to Gelato
(`:232`). So the printer holds the journal owner's email and can write to them
whenever it likes — order confirmations, dispatch notices, marketing, a
password reset for an account they never opened.

The owner's decision to buy a book from **this** instance is not a decision to
enter a relationship with its supplier. Every word a customer gets about their
book should come from Fernscout, in their language, with Fernscout's account of
what happened — not from a third party they have never heard of, in whatever
tone and language Gelato picks, quoting a reference that means nothing on this
site.

**The recipient is already safe and should stay that way.** The address sent is
the *owner's*, never the recipient's — a book to somebody else does not hand
Gelato that person's email at all. That part is right; this ticket must not
regress it.

There is also a practical edge: if Gelato mails the owner "your order failed"
while Fernscout has already refunded and mailed its own account of it, the two
stories arrive in the same inbox and disagree about what to do next.

## Work

- Send an address the **operator** controls, not the owner's:
  `FERNSCOUT_ADMIN_EMAIL` where set, falling back to the site's own contact
  address. Gelato needs a deliverable address on the order; it does not need
  the customer's.
- Check Gelato's order payload for any notification switch (a `metadata` flag,
  a shop-level setting) that suppresses customer mail, and use it as well if
  one exists. Belt and braces: the address is what we control from here.
- Same question for the postcard provider — `lib/postcard/send.ts` should be
  read for the same pattern rather than assumed clean.
- A test asserting no journal owner's address and no contact's address appears
  in what is posted to a print provider. `test/postcard-orders.test.ts`
  already has the shape of this kind of guard.

**Not in this ticket.** No change to what Fernscout itself mails, and no change
to the recipient's postal address, which Gelato genuinely needs in order to
post the book.

## Acceptance

- The order posted to Gelato carries no journal owner's email and no contact's
  email.
- A test fails if one is reintroduced.
- A real order still reaches Gelato and still prints.
- `npm run verify` clean.
