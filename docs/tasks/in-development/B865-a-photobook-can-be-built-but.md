---
id: B865
title: A photobook can be built but never printed
type: FEATURE
priority: high
complexity: high
area: photobook, print, credits
found: "2026-09-07T17:29:37Z"
started: "2026-09-07T17:35:13Z"
session: ce87fdc2-3f66-428c-90d3-ae9d8df84e40
claimed: "2026-09-07T17:35:13Z"
---

# B865 — A photobook can be built but never printed

## Why

`lib/photobook/orders.ts:88` writes `provider: "dry-run"` on every row with a
comment saying no provider is called, and `status: "printed"` means the PDFs
reached the disk. Nobody has ever been sent a book. The person who paid gets a
download.

Everything up to the account boundary was built and then stopped there. There
is now a working key, a verified product and a real quote (see B864), so the
boundary has moved.

Two facts shape the work. **Gelato accepts no upload** — it fetches the
interior and cover PDFs from URLs in the order, and the route those files sit
behind takes an owner cookie no printer can present. And **the sandbox always
reports `Cancelled`**, so no test may assert otherwise.

## Work

The whole of `docs/superpowers/plans/2026-09-07-photobook-gelato-print.md`,
task by task. In short:

- A signed short-lived link (`lib/photobook/fileLink.ts`), accepted by the
  existing file route as an alternative to the owner cookie.
- `lib/photobook/gelato.ts` — quote, submit, read status. Mirrors
  `lib/postcard/stannp.ts`: `providers.ts` builds the map, this posts it.
  `orderType: "draft"` unless `features.photobook.live`.
- Print state on the existing `print_orders` row. No migration — `provider`,
  `provider_ref`, `contact_id`, `cost_minor` and `currency` are already there
  and unused. Double-press guard is rows-affected on `printed ->
  print_submitted`.
- Claim, spend, submit, refund what the provider refused — `lib/postcard/send.ts`'s
  order of operations, for the reasons stated there.
- Recipients by `contactId` only. Addresses never reach an agent. The one
  difference from postcards: `wantsPostcard` is not required, because a book to
  yourself must not need a postcard box ticked.
- `POST /api/v1/<user>/photobooks/<id>/print` proposes; the owner's own page
  prints. A test asserts nothing under `app/api/` imports the submit function.
- A new `photobook_print` spend reason, and the build price drops so paper is
  not charged for twice.

Not doing: a status webhook, reprinting an existing order, or any provider
besides Gelato.

## Acceptance

- `npm run verify` passes.
- A signed link serves the PDF; an expired one, a tampered one and one signed
  for a different file each 404.
- Two simultaneous presses spend one book's credits and place one order.
- A refused provider leaves the balance untouched and the order back at
  `printed`.
- `GET /api/v1/<user>/photobooks/<id>` reads back the proposal an agent wrote,
  and its response contains no street address.
- Against the deployed instance with a **sandbox** key: an order id comes back,
  `provider_ref` is set, and the status reads `Cancelled` — which is what the
  sandbox always says and is the proof it worked.

## Blocked on

B864 — a book laid out at a size Gelato cannot print cannot be ordered.
B108 — a book has to have been generated on the deployed instance first.
