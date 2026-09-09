---
id: B1145
title: The print panel summarises an address where it should show the envelope
type: FEATURE
priority: high
complexity: low
area: photobook, print
found: "2026-09-09T20:45:00Z"
started: "2026-09-09T18:36:36Z"
session: ce87fdc2-3f66-428c-90d3-ae9d8df84e40
claimed: "2026-09-09T18:36:36Z"
---

# B1145 — The print panel summarises an address where it should show the envelope

## Why

The panel says *"Going to Severin Lindenmann, Wohlenschwil, CH."* — a name and
a town on one line — and then asks for 165 credits to put a physical object in
the post. The owner is checking an envelope and is shown a summary of one.

The town-only rule it follows is real but is about somebody else:
`bookRecipients` withholds the street so an **agent** proposing a book never
holds an address (B434). The owner on their own order page is the person the
postcard flow already shows a full address to, behind a disclosure on the
preview page, for exactly this reason — they are about to pay for a delivery.

Two people at one address is what makes it acute, and it is the normal case for
a family journal. The picker's dropdown currently reads:

```
Severin Lindenmann — Wohlenschwil, CH
Viktória Lindenmann — Wohlenschwil, CH
```

Only the first name distinguishes them, and a `<select>` cannot carry a second
line — the browser draws that menu.

Requested by the owner, with a proposal agreed before building: the recipient
as a centred address block, and radios carrying the full address instead of a
dropdown.

## Work

- Replace the `photobook.print.to` sentence with an address block: a small
  "Going to" label, the name centred and a step larger, then street, postcode
  and town, then country. It reads as an envelope because it is laid out like
  one.
- Swap the `<select>` for radio rows, each carrying name and full address.
  Still inside the `<details>`, still the same GET form, still no JavaScript.
- The page resolves an address per recipient rather than only for the chosen
  one, and passes them to the panel. `bookAddressFor` per person — the list is
  a handful of people, so the repeated `eligible()` walk is not worth avoiding.
- **`bookRecipients` does not change.** The agent-facing shape stays a name and
  a town, and `test/photobook-recipients.test.ts` already fails if a street or
  an email joins it.

## Acceptance

- The panel shows the full postal address of whoever the book is going to,
  with the name centred above it.
- Opening the disclosure lists every eligible person with their full address,
  and choosing one still re-quotes for their country.
- Both are visible only to the owner: the page 404s for everybody else, and no
  API response gains an address.
- `npm run verify`.
