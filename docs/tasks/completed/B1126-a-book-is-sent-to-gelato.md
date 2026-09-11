---
id: B1126
title: A book is sent to Gelato with a country name where it requires an ISO code
type: ISSUE
priority: high
complexity: low
area: photobook, gelato
found: "2026-09-09T18:10:00Z"
started: "2026-09-09T18:04:54Z"
merged: "2026-09-09T18:13:32Z"
---

# B1126 — A book is sent to Gelato with a country name where it requires an ISO code

## Why

`printOrder` resolves the recipient's country to an ISO code for the *quote*
and then hands the *order* the raw stored value:

```ts
const country = isoCountry(to.country);        // lib/photobook/print.ts — "CH"
…
to: { …, country: to.country ?? "" },           // "Switzerland"
```

`buildGelatoRequest` passes that straight into the request
(lib/photobook/providers.ts:211, `country: order.to.country`) with no
conversion, and Gelato refuses the order:

```
{"code":"BAD_REQUEST","details":[{"message":"This value is not a valid country.",
  "reference":"shippingAddress.country","code":"other"}]}
```

Measured on 2026-09-09 by pressing the button on a real order page against the
live API, with a contact whose address says `Switzerland`.

Contacts store the country as it was entered, so this refuses any recipient
whose address was written the way people write addresses — "Switzerland",
"Schweiz", "Deutschland". The quote succeeds, the panel shows a price, the
button is pressed, credits are spent, and only then does the printer refuse.

**The money is safe and the failure is loud** — `printOrder` refunds and marks
the order failed, which was verified in the same run: `-17200` then `+17200` in
`credit_ledger`, balance whole, and the page comes back `?print=refused`. So
this costs an owner a confusing dead end rather than money.

The fix is to send the ISO code that has already been computed two lines
above; `printOrder` already refuses `unknown_country` when it cannot resolve
one, so there is no case where the code is missing.

Found while verifying B1093. Second of two malformed-request bugs in the same
call path — B1125 is the quote's missing `itemReferenceId` — and together they
are why no photobook has ever reached Gelato from the product.

## Work

- Pass the resolved `country` into the `to` block that `submitBookPrint`
  receives, instead of `to.country`.
- Check the other print providers in `lib/photobook/providers.ts` for the same
  assumption before changing the shared `to` shape — some may want the name.
- A test that a full country name reaches the provider as an ISO code would
  have caught this; every existing test mocks `submitBookPrint`.

## Acceptance

- An order to a contact whose address country is `Switzerland` is accepted by
  Gelato rather than refused.
- `npm run verify`.
