# Printing a photobook: connecting Gelato

**Date:** 2026-09-07
**Status:** design, approved in conversation. Nothing built.

## The problem

Everything up to the account boundary is done. A trip becomes a laid-out,
print-ready book with a cover; `lib/photobook/providers.ts` builds a Gelato
request; `lib/photobook/orders.ts` records the order. Nothing calls anybody.
`provider` on every row reads `"dry-run"`, and `status: "printed"` means *PDFs
were written to disk*, which is not what the word says to the person who paid.

Three facts shape everything below:

1. **Gelato accepts no upload.** It fetches the interior and cover PDFs from
   URLs given in the request. Today those files sit behind an owner cookie
   (`app/[user]/photobooks/[id]/[file]/route.ts`), which Gelato cannot get past.
2. **Gelato has a sandbox**, reached with a different key on the same
   hostnames. Sandbox orders are auto-cancelled, never printed, never charged —
   and their status **always reads `Cancelled`**, which is a trap for any test
   asserting on it. Production keeps a second net: `orderType: "draft"`
   validates the files and prints nothing until the order is PATCHed.
3. **Every field name in `buildGelatoRequest` is written from published
   documentation and has never met a live account.** The `productUid` is a
   plausible fake, and it encodes `pt_{n}-pages` *while also* sending
   `pageCount` as a sibling field. Those cannot both be right.

## Decisions taken

| Question | Answer |
| --- | --- |
| How Gelato gets the PDF | A signed, short-lived URL on this instance. No object storage, no new infrastructure. |
| Where the sandbox is driven from | The deployed instance, with a sandbox key in its environment. Gelato must reach the URL, so localhost cannot answer. |
| Where printing sits | A second step after the build, on the finished order's page. A book can be built and never printed. |
| Who it ships to | A contact, by `contactId`. Addresses never reach an agent — the postcard rule, unchanged. |
| What an agent may do | Propose. A person presses print. |
| Pricing | The build price drops to what a render costs; the print step charges the live Gelato quote plus margin, frozen at the panel. |

## Phase 0 — the probe

Read-only, throwaway, and nothing else can be designed honestly without it.
Four calls with a real key:

| Call | Answers |
| --- | --- |
| `GET product.gelatoapis.com/v3/catalogs` | the key works; which environment it belongs to |
| `POST /v3/catalogs/{uid}/products:search` | the real `productUid` for 210 x 210 softcover perfect bound, and whether `pageCount` is a field or lives in the uid |
| `GET /v3/products/{uid}/prices` at 32 / 52 / 100 / 160 pages | the per-page cost basis |
| `POST order.gelatoapis.com/v4/orders:quote` to a Swiss address | real shipping cost, and the `shipmentMethodUid` values (`"normal"` is another guess) |

**Deliverable:** the figures recorded in `docs/providers/photobook.md`;
`PHOTOBOOK_BASE_CREDITS` and `PHOTOBOOK_PAGE_CREDITS` set against them;
`PHOTOBOOK_PRICING_VERIFIED` flipped to `true`;
`test/photobook-pricing.test.ts` asserting the quoted figures. No order placed,
no product change. This is **B841**, which already exists in `backlog/chore/`.

`BINDING_PROFILES` in `lib/photobook/spec.ts` carries `verified: false` for the
same reason and should be corrected in the same pass wherever the catalogue
contradicts it.

## Phase 1 — the file link

Not a new route. `app/[user]/photobooks/[id]/[file]/route.ts` gains an
alternative to the owner cookie: a valid `?exp=&sig=` serves the file, and
anything else falls through to the existing `isOwner` check. One route, two
ways in, no second copy of the path validation.

`lib/photobook/fileLink.ts` holds `sign()` and `verify()`: HMAC-SHA256 over
`owner/id/file/exp`, keyed on `accessSecret()` (`lib/access.ts:34`) — the same
construction `lib/agentConfirm.ts:86` already uses. Expiry 24 hours, which is
slack for Gelato's own retries rather than a guess at how fast it fetches.

The trade, stated plainly: for those hours the book is readable by whoever
holds the link. That is the same trade the postcard preview URL already makes,
and the alternative — a token row per order — buys revocability nobody has
asked for.

Tests: expired refused, tampered signature refused, a signature for a different
file refused, valid served, and the owner-cookie path unchanged.

## Phase 2 — the client

`lib/photobook/gelato.ts`, mirroring `lib/postcard/stannp.ts` exactly:
`providers.ts` builds the map, this posts it and does nothing else, so the
payload stays assertable in a test with no key and no network.

- `quoteBook()` — for the panel's price.
- `submitBookPrint()` — the one call that commits.
- `orderType` is `"order"` only when `features.photobook.live` is true;
  otherwise `"draft"`. Same shape as `features.postcards.live`.
- No `GELATO_API_KEY` returns `provider_unavailable` rather than throwing.
- `/api/health` reports which of the two environments the key belongs to, the
  way `lib/stripe.ts` prints the mode it read.

## Phase 3 — the print step

**No migration.** The `print_orders` row already carries `provider`,
`provider_ref`, `contact_id`, `cost_minor` and `currency`, all unused by the
photobook path. One book is at most one print job, so the print job lives on
the build's own row; a reprint is a new build, which is also the honest answer
because the files may have been pruned (B483).

The double-press guard comes free from the `status` column — the rows-affected
trick `claimForSend` already uses: `printed -> print_submitted`, gated on
`status = 'printed'`. Two presses race, one wins, the loser is told the book is
already being printed, which is true.

Order of operations copied from `sendOrder` verbatim, for the reasons stated
there: **claim, then spend, then submit, then refund what the provider
refused.** Claiming first is what makes a double press cost one book.

Recipients come from the same `eligible()` gate as postcards — `status ===
"active"` and `isPostable` — with one deliberate difference: `wantsPostcard` is
consent to receive *postcards* and is not asked for here. A book to yourself
must not require having ticked a postcard box. The comment says so.

Stale quotes are refused, not re-priced: B595's `stale_preview` shape. If the
price the button showed is not the price now, the answer is a fresh panel,
never a charge at the new number.

## Phase 4 — the two doors

- `POST /api/v1/<user>/photobooks/<id>/print` — the agent's door. Writes the
  `contactId` and the frozen quote onto the order, answers with the URL of the
  page where a person presses the button. Charges nothing, prints nothing.
- `GET /api/v1/<user>/photobooks/<id>` — because a field the API accepts is a
  field it has to read back, or an agent cannot check its own work.
- `app/[user]/photobooks/[id]/print/route.ts` — owner cookie only, and the only
  caller of `submitBookPrint`. A test asserts that nothing under `app/api/`
  imports it, exactly as `test/postcard-orders.test.ts` does for `sendOrder`.

Both API routes go into `lib/api/openapi.ts` with at least one documented
refusal each, and into `/agent.md`. An agent hands over a URL and says a
preview is waiting. It does not say a book has been printed.

## Phase 5 — status

**No webhook.** `GET /v4/orders/{id}` when the owner opens the order page,
cached into the payload. Sandbox always answers `Cancelled`, so no test may
assert otherwise. A webhook route is worth having eventually and is a separate
capture, not this ticket.

## Pricing

B840 set `PHOTOBOOK_BASE_CREDITS = 160` to cover roughly CHF 25 of landed print
cost inside the build price. With printing charged separately, that number
would charge for paper twice. So the build price drops to what a render costs,
and the print step charges the Phase 0 quote plus margin. The public pricing
table (`components/Pricing.tsx`) gains a print row and loses its "estimate"
label once `PHOTOBOOK_PRICING_VERIFIED` is true.

## Not doing

- Object storage for the PDFs.
- A second `print_orders` table, or a `photobook_print` kind.
- A status webhook.
- Reprinting an existing order.
- Any other provider. Peecho, Cloudprinter and Lulu stay as tested builders.

## Dependencies

**B108** (*The photobook has never been generated by the deployed instance*,
OPS) is in `in-development/` and held by another session. A book has to exist
on the deployed instance before one can be printed from it.
