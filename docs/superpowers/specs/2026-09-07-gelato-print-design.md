# Printing a photobook: connecting Gelato

**Date:** 2026-09-07
**Status:** design, approved in conversation. Phase 0 has been run against a
real key — its findings are below and they changed the design. Nothing built.

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
| Page geometry | Gelato's catalogue is the source of truth. The generator is reworked to match it, not the other way round. |

## Phase 0 — RUN. What Gelato actually says

Four read-only calls with a real key, 2026-09-07. No order placed, nothing
charged. The key authenticates; **which environment it belongs to is not
visible from the API** — sandbox and production share hostnames and both quote
freely — so the dashboard's API portal is the only place to read that.

### The finding that changed the design: our page sizes do not exist

| This repository plans | Gelato offers |
| --- | --- |
| Square **210 x 210 mm** | Square **200 x 200** (also 140 x 140, and 280 x 280 hardcover) |
| A4 portrait 210 x 297 | **210 x 280** |
| A4 landscape 297 x 210 | nothing softcover above 140 x 215; **210 x 280 landscape is hardcover only** |
| Perfect bound 32-160, multiple of 4 | **28-200, step 2** — identical on every product |
| Saddle stitch 4-48 | **does not exist.** `BindingType` is `glued-left` and nothing else |

`BINDING_PROFILES` in `lib/photobook/spec.ts` is therefore wrong in every row,
which its own `verified: false` predicted. Two profiles collapse to one rule:
**even, 28 to 200**.

The `productUid` in `buildGelatoRequest` was invented. Real ones read:

```
photobooks-softcover_pf_200x200-mm-8x8-inch_pt_170-gsm-65lb-coated-silk
  _cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0
  _cpt_250-gsm-100-lb-cover-coated-silk_ver
```

and **`pageCount` is a sibling field, not part of the uid** — so the builder's
apparent contradiction was simply an invented string. Note also that the
catalogue lists each format twice under mirrored names
(`200x200-mm-8x8-inch` and `8x8-inch-200x200-mm`); pick one and pin it.

### Real prices, delivered to Zurich, CHF, ex-VAT

| Pages | SC 200x200 | HC 200x200 | SC 210x280 | HC 210x280 hor | HC 280x280 |
| --- | --- | --- | --- | --- | --- |
| 32 | 11.18 | 14.68 | 11.43 | | |
| 52 | **14.40** | 18.35 | 14.99 | 19.81 | 27.36 |
| 100 | 22.12 | 27.14 | 23.51 | | |
| 160 | 31.78 | 38.13 | 34.16 | | |

The square softcover is almost exactly linear: **CHF 6.04 + CHF 0.161 a page.**

**Printed in Switzerland** (`productionCountry: "CH"`), which is the headline
result — no customs, no border. Swiss Post Economy **CHF 8.52** (4-7 days),
Priority CHF 10.64 (3 days). `shipmentMethodUid` is `swiss_post_economy` /
`swiss_post_priority`; the `"normal"` in the current builder is a guess and
wrong.

**A 52-page square softcover therefore lands at CHF 22.92.** B840's estimate of
~CHF 25 was close, and the current build charge of CHF 52.80 is about 2.3x it.

### One more field difference

`orders:quote` takes `recipient` with a `country` key. `buildGelatoRequest`
writes `shippingAddress` with `country`. Both may be right — they are different
endpoints — but only a draft order proves the create side.

## Phase 0b — the formats become Gelato's

The generator follows the catalogue rather than the other way round; the three
sizes on offer become three that exist:

| Offered as | productUid family | 52pp |
| --- | --- | --- |
| **Square** (default) | `photobooks-softcover ... 200x200 ... _ver` | CHF 14.40 |
| **Portrait** | `photobooks-softcover ... 210x280 ... _ver` | CHF 14.99 |
| **Landscape** | `photobooks-hardcover ... 210x280 ... _hor` | CHF 19.81 |

**The one compromise, stated rather than buried:** there is no softcover
landscape above 140 x 215, so choosing landscape chooses hardcover. That is a
different cover wrap — board wrap and turn-in, not just spine width — so the
cover renderer needs a hardcover case as well. If that is not worth it,
landscape is dropped rather than faked, and the third slot goes to 280 x 280
hardcover as a large square.

Work this implies, and it is real:

- `PAGE_SIZES` and `BINDING_PROFILES` in `lib/photobook/spec.ts` rewritten from
  the catalogue, `verified: true`, with the productUid beside each.
- Bleed box 206 x 206 rather than 216 x 216; a full-bleed square photo needs
  **2409 px** at 300 DPI, not 2551.
- Spine maths re-checked against 200 mm stock; the hardcover case is new.
- The page planner's counts move to even/28-200, which widens the top end from
  160 to 200 and lowers the floor from 32 to 28.
- `/docs/branding/print` re-read afterwards. A drawing is the one output no
  test can check.

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
and the print step charges the measured figure plus margin.

The cost basis is now real rather than estimated: **CHF 6.04 + CHF 0.161 a
page, plus CHF 8.52 postage**, for the square softcover delivered in
Switzerland. A 52-page book lands at CHF 22.92. `PHOTOBOOK_PRICING_VERIFIED`
becomes `true` and `components/Pricing.tsx` loses its "estimate" label and
gains a print row.

Two things the margin has to carry that the quote does not show: VAT, and
delivery outside Switzerland, which is a different quote every time. The panel
quotes live per order for exactly that reason — a fixed price for a book going
to Australia is a price that is wrong.

## Not doing

- Object storage for the PDFs.
- Saddle stitching, which Gelato does not offer.
- A second `print_orders` table, or a `photobook_print` kind.
- A status webhook.
- Reprinting an existing order.
- Any other provider. Peecho, Cloudprinter and Lulu stay as tested builders.

## Dependencies

**B108** (*The photobook has never been generated by the deployed instance*,
OPS) is in `in-development/` and held by another session. A book has to exist
on the deployed instance before one can be printed from it.
