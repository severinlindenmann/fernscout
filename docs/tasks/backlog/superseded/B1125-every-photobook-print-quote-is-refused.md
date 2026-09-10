---
id: B1125
title: Every photobook print quote is refused, so the print panel can never appear
type: ISSUE
priority: high
complexity: low
area: photobook, gelato
found: "2026-09-09T17:55:00Z"
superseded: Already fixed. lib/photobook/gelato.ts:107-115 sends itemReferenceId: "book" with a comment naming B1125.
---

# B1125 — Every photobook print quote is refused, so the print panel can never appear

## Why

`quoteBook` (lib/photobook/gelato.ts:105) posts to Gelato's v4 `orders:quote`
with a product that has no `itemReferenceId`:

```ts
products: [{ productUid: input.productUid, pageCount: input.pageCount, quantity: 1 }],
```

Gelato requires it. Measured against the live API on 2026-09-09 with the
instance's own key:

```
{"code":"BAD_REQUEST","message":"There are errors in submitted data",
 "details":[{"message":"This value should not be blank.",
             "reference":"products[0].itemReferenceId","code":"other"}]}
```

Adding `"itemReferenceId": "book-1"` and changing nothing else returns a full
quote with prices and shipment methods. So this is not a key problem, a
catalogue problem or a network problem: the request has always been malformed.

**Everything downstream of a quote is therefore dead**, and has been since the
Gelato work landed:

- `proposeBookPrint` returns `provider_unavailable`, so an agent cannot
  address a book.
- The order page shows "The printer could not be reached for a quote", so the
  print panel — and its button — never render at all.
- `printOrder` re-quotes before it claims or spends, so even an order that was
  addressed some other way would refuse there.

This is very likely the whole reason B911 records the in-product print flow as
never having been run live. Nothing about the failure names the field; it
surfaces as "the printer could not be reached", which reads like Gelato being
down.

Found while verifying B1093 in a browser against the local `example` journal —
a page that had been built and typechecked green, whose panel could not appear
for a reason no test could see, because every test mocks `quoteBook`.

## Work

- Send an `itemReferenceId` on the quote's product. It is Gelato's handle for
  one line of an order and must be non-blank; it does not have to be
  meaningful to us.
- **`submitBookPrint` is not affected** — `buildGelatoRequest` already sets
  one — so this is the quote path only.
- Consider whether `refused` is the right failure for a 400. The response body
  names the offending field, and logging it (as `post` does) is what turned
  this from "Gelato is down" into a one-field fix.

## Acceptance

- A quote against the real API returns prices rather than `BAD_REQUEST`
  (`orders:quote`, live key, any catalogue product).
- The order page for a built book renders the print panel instead of
  "the printer could not be reached".
- `npm run verify`.

## Note

Fixed inside B1093's branch rather than on its own, because B1093's acceptance
— "an owner can reach the print panel" — cannot be demonstrated at all while
this stands, and the fix is one field. Recorded here rather than folded
silently into that ticket.
