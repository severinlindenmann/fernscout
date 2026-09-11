---
id: B1439
title: Gelato is handed the owner's email address and can write to them directly
type: SECURITY
priority: high
complexity: low
area: photobook, gelato, privacy
found: "2026-09-11T10:31:22Z"
started: "2026-09-11T11:09:24Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T11:09:24Z"
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

---

## Decided 2026-09-11

The owner's word: **hand over `agent@fernscout.ch` — always the instance admin
address, never the journal owner's. Gelato needs the shipping address, name
and postal address, and nothing else. Everything else, billing included, is
the instance operator's.**

### It is one line, and the rest is already right

Traced end to end:

- `lib/photobook/print.ts:207` — `const email = getUser(owner)?.owner.email ?? ""`
  is the only place a person's address enters a print request.
- `lib/photobook/providers.ts:204-212` — `buildGelatoRequest` puts it in
  `shippingAddress.email` beside the name and postal fields.
- There is **no billing block and no phone number** in the request. Gelato
  bills the account behind `GELATO_API_KEY`, which is the operator's already,
  so "billing must be our instance" is satisfied by construction and needs no
  change.
- The **recipient's** email is never sent and never was — the address in that
  field is the owner's, not the person the book goes to. That property must
  survive this change.
- `lib/postcard/send.ts` passes no email at all, so the other print provider
  is already clean. Nothing to do there.

So: replace that one expression with `adminEmail()` (`lib/admin.ts:40`), and
decide the fallback for an instance that has not set `FERNSCOUT_ADMIN_EMAIL`.

### The fallback matters more than it looks

`adminEmail()` returns `null` when the environment does not name an operator,
which is the default and every other instance's normal state. The old code
had a `?? ""` fallback and an empty string may well be what Gelato rejects —
but falling back to the owner's address would quietly reinstate exactly the
leak this ticket closes, on precisely the instances least likely to notice.

Prefer, in order: `adminEmail()`, then the site's own contact address from
`site/config.json` if one is configured, then an empty string. **Never the
owner's.** If Gelato refuses an order for want of an address, that is a
configuration error an operator can read and fix, and it is the safe
direction to fail in.

## Work

- `lib/photobook/print.ts:207` — use the operator's address per the order
  above.
- A test that fails if a journal owner's address or a contact's address ever
  appears in what is posted to a print provider. `test/postcard-orders.test.ts`
  already has the shape of this kind of import/reachability guard; this one
  asserts on the built request body.
- Say in a comment beside the line why it is not the owner's address: the
  owner's decision to buy a book here is not a decision to enter a
  relationship with the supplier, and every word about the book should come
  from Fernscout.

**Not in this ticket.** No change to the postal address, which Gelato needs.
No change to what Fernscout itself mails. No change to the postcard provider,
which is already clean.

## Acceptance

- The order posted to Gelato carries the instance operator's address, never a
  journal owner's and never a contact's.
- With `FERNSCOUT_ADMIN_EMAIL` unset the request does not fall back to the
  owner's address.
- A test fails if either is reintroduced.
- `npm run verify` clean.
