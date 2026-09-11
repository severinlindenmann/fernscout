---
id: B1145
title: The print panel summarises an address where it should show the envelope
type: FEATURE
priority: high
complexity: low
area: photobook, print
found: "2026-09-09T20:45:00Z"
started: "2026-09-09T18:36:36Z"
merged: "2026-09-09T18:49:13Z"
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

## Evidence

Checked on `/example/photobooks/eae6122c-…`, a journal and a book this branch
did not write.

- The envelope block: "GOING TO / **Alex Berger** / Feldweg 18 / 5512
  Wohlenschwil / Switzerland", centred, name a step larger.
  `/tmp/b1145-final/…-1280.png`, `…-390.png`.
- The disclosure open on the second person: both rows carry the full address,
  the chosen one is outlined, and the quote re-took for them.
  `/tmp/b1145-open/…-1280.png`.
- `npm run verify` — all five green.

Two things changed after looking, which is what looking is for: the envelope
box sat flush against the price line (`mt-1` → `mt-3`), and the list came back
in contact order, so the owner — the default — was second. It is sorted
`self` first now: a list whose first row is not the selected one reads as
though the choice were made by an ordering the reader cannot see.

The four Hungarian strings this ticket and B1093 add are English copies. I can
write the German and did; I cannot write Hungarian well enough to put it in
front of somebody whose language it is. They join what B912 already tracks.
