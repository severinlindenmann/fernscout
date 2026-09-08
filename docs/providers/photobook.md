# Photobook providers

What is built, what deliberately is not, and exactly what is needed to go live.

**Status: a draft order has been placed with Gelato, accepted, and its files
fetched. They have not been preflighted, and no paper has been produced.** A trip becomes a
planned, laid-out, print-ready book with a cover and a preview, and the whole
chain to Gelato was driven end to end from the deployed instance on
2026-09-08:

| Step | Result |
| --- | --- |
| Book built on fernscout.ch, charged 40 credits | 28-page interior 206 × 206 mm, cover 408.72 mm wide |
| Signed file URL fetched with no cookie | `200`, 9.3 MB. Unsigned, tampered, expired, and signed-for-another-file all `404` |
| `POST /v4/orders` with `orderType: "draft"` | accepted — `fulfillmentStatus: "draft"`, our product uid, our address |
| Gelato fetched both PDFs | rehosted on its own S3, `filesSize` 8.9 MB, `refusalReason` null |
| A product mock-up rendered | `preview_flat`, `preview_default`, `preview_thumbnail` — all three from the **cover** file alone |
| Prepress did **not** run | `prepressWorkflowId` null, `dpi` 0, `eventLog` and `printJobs` empty |
| Draft deleted afterwards | `200`, then `NOT_FOUND` |

**So the create-order request shape in `lib/photobook/providers.ts` is
confirmed against the live API**, which it had never been before — everything
in it used to be written from published documentation. The cover Gelato
rendered from our file is the one this repository draws.

### The TrimBox is the fold line, not the content edge

All six size-and-cover combinations were built on fernscout.ch and submitted as
drafts on 2026-09-08. The hardcovers came back with the front-cover title
clipped and the artwork shrunk into a corner; the softcovers were fine.

The cause was one number. The cover PDF's `TrimBox` was inset by
`wrapMm + bleedMm` — 20 mm, which is where the **board content** starts
(`contentBackSize.left`). Gelato trims a case at its **fold**, which is
`wraparoundEdgeSize` at 17 mm, and the remaining 3 mm is bleed carried round
the turn-in. Gelato places artwork from the TrimBox, so a box 3 mm tight on
every edge made it rescale the whole sheet.

A softcover was right by accident: its wrap is 0, so `0 + bleed` is the bleed,
which is exactly what its trim is. That is why the bug was invisible until a
hardcover was submitted, and why it would never have shown up in a test that
only exercised the default size.

`CoverGeometry.trimInsetMm` now carries it explicitly — the bleed for a
softcover, the wrap for a hardcover — and `fetchCoverGeometry` derives it from
Gelato's own answer. Verified against all six products: our MediaBox equals
`wraparoundInsideSize`, and our TrimBox equals `wraparoundEdgeSize`, to the
hundredth of a millimetre.

### Gelato's own template, which is the only reference that comes from them

`docs/providers/gelato-templates/` holds a template downloaded from the Gelato
dashboard, and its README is the detail. In short: for the 210 x 280
softcover it is one cover page of **428.72 x 286 mm** and thirty interior
pages of **216 x 286 mm** — exactly what this writer emits — and **every page
carries `TrimBox == BleedBox == MediaBox`**.

That last one is why our own trim box now spans the whole sheet rather than
sitting inside the bleed, which is what print convention would say. Gelato
positions artwork from the TrimBox; an inset one made it rescale the sheet.

No hardcover template has been downloaded yet, and that is the gap worth
closing: every hardcover measurement we hold comes from the API rather than
from a file Gelato produced.

**Both things that looked wrong in Gelato's previews were our TrimBox.**
They are recorded here because the wrong explanation was written down twice
before the right one was found, and both wrong explanations were plausible.

The symptoms: a black band down the right and along the bottom of
`preview_flat`, and a hardcover `preview_default` mock-up that cropped the
front panel and clipped the first word of the title. The softcover mock-up of
the same book was perfect, which is what made it look like a Gelato bug.

It was not. **Gelato positions artwork from the TrimBox**, and this writer was
declaring one inset from the sheet — first by `wrap + bleed`, then, after a
half-fix, by the wrap. Gelato's own product template declares
`TrimBox == BleedBox == MediaBox` on every page. Matching it fixed both
symptoms at once:

| | inset TrimBox | matching the template |
| --- | --- | --- |
| `preview_flat` fill, softcover | 97.3% | **100%** |
| `preview_flat` fill, hardcover | 86.3% | **100%** |
| hardcover mock-up | title clipped | **whole title** |

Two lessons worth keeping. **The band was measured and explained correctly and
the conclusion was still wrong** — `min(trimW/mediaW, trimH/mediaH)` predicted
the fill to a tenth of a percent, which made "their compositor shows the
trimmed area" convincing; it simply was not the reason it should be ignored.
And **"the softcover works, so it must be their bug" was the wrong inference**:
the softcover worked because its wrap is zero, so its inset was 3 mm rather
than 20, small enough not to show.

**A draft is a parked cart, not a preflight — and this is the trap in reading
the result above.** Gelato builds the product mock-up from the cover as soon
as it has the file, which looks like acceptance and is not. The page-by-page
interior preview on its checkout page never appears for a draft; it comes from
prepress, and prepress runs when a draft is promoted to an order. So **nothing
has yet checked our interior PDF** — not its resolution, not its fonts, not
its colour space. The one thing the draft proves about the files is that
Gelato could reach and download them.

That matters more than it sounds, because this writer emits RGB with
unembedded base-14 fonts (below). `pdffonts` reports Helvetica,
Helvetica-Bold and Helvetica-Oblique all `emb: no` on both files. A printer
substitutes what it does not have. Whether Gelato refuses that, silently
substitutes, or accepts it is unknown and will stay unknown until an order is
promoted.

**What has still never happened: a real order.** `orderType` is `"order"` only
when `features.photobook.live` is true, and it is not. The account behind the
key has no payment method, so a real order would fail at billing rather than
print. Nobody has held one of these books.

Two smaller things also remain untested: the in-product print flow
(`POST /api/v1/<user>/photobooks/<id>/print`, then the owner's button) has
never run against the live site, because the demo journal has no contact with
a postal address to send a book to — the draft above was posted directly. And
no hardcover has been through Gelato at all; only the 200 × 200 softcover has.

**One thing in this document is uncomfortable and is stated plainly rather than
buried: the PDF this writer emits is RGB with unembedded base-14 fonts, which
is not PDF/X.** [What that means, and the one command that fixes it](#colour-the-honest-position),
below.

---

## What works today, with no account

```bash
npm run photobook -- --trip <user>/<trip-id>                      # the whole book
npm run photobook -- --trip <user>/<trip-id> --guides             # + trim and safe-area guides
npm run photobook -- --trip <user>/<trip-id> --outline            # just the page plan, as text
npm run photobook -- --trip <user>/<trip-id> --size portrait      # pocket, square, portrait or large-square
npm run photobook -- --trip <user>/<trip-id> --cover hard          # soft (default) or hard — not every size has both
npm run photobook -- --trip <user>/<trip-id> --icc <profile.icc>  # embed an output intent
npm run photobook -- --providers
```

Writes to `content/<user>/photobooks/` (gitignored):

| File | For |
| --- | --- |
| `<trip>-interior.pdf` | The book. One PDF page per printed page, in order |
| `<trip>-cover.pdf` | Back cover, spine and front cover on one wide page |
| `<trip>-preview.html` | Every page at low resolution, from the same layout data |
| `<trip>-plan.json` | The page plan — what went where, and why |
| `<trip>-pdfx.txt` | The PDF/X readiness report. Read it before ordering |
| `<trip>-<provider>-request.json` | The request that *would* be sent, for each of the four |
| `PDFX_def.ps`, `gs-pdfx.sh` | Written when `--icc` is given: the Ghostscript step, runnable as printed |

A trip long enough to exceed the binder's maximum becomes several volumes,
`<trip>-v1-interior.pdf` and so on, each a complete book with its own cover and
its own order.

The script runs under `tsx --conditions=react-server`. That is not decoration:
`lib/trips.ts`, `lib/entries.ts` and `lib/costs.ts` are marked `server-only`,
whose package exports resolve to an empty module under that condition and to a
throwing one otherwise. It is the same switch Next flips for server components,
used here for the same reason — so the CLI reads content through exactly the
code the website uses, with no second parser to drift.

### The print geometry, and why it is what it is

| | |
| --- | --- |
| Default size | Square 200 × 200 mm — a real Gelato product, softcover, and neither photo orientation is second class. **Not** 210 × 210: that square is what this document used to say and is a size Gelato does not print |
| Also available | Pocket 140 × 140 mm (softcover only — the cheapest thing on offer), Portrait 210 × 280 mm (the nearest Gelato product to A4, which Gelato does not print either), Large square 280 × 280 mm (hardcover only) |
| Cover | Soft or hard, chosen **before** the size — not every size exists in both. Softcover: pocket, square, portrait. Hardcover: square, portrait, large-square. There is no 280 mm softcover and no 140 mm hardcover |
| Bleed | 3 mm on all four edges → media box 206 × 206 mm for the square size |
| Outer margin | 10 mm inside the trim |
| Gutter | **16 mm** at the spine — wider than the outer margin, because a perfect-bound book does not open flat and the first few millimetres curve away from the reader |
| Resolution | 300 DPI. A full-bleed square photo therefore needs **2363 px** at 200 mm |
| Handedness | Page 1 is a recto. The gutter alternates from there, and the layout knows which hand it is on |
| Spine | `pages / 2 × 0.115 mm` — leaves, not pages. Get this wrong and the front image creeps onto the spine |
| Boxes | `TrimBox` and `BleedBox` on every page, including the cover |

Every size carries a `covers` map (`{ soft?: uid, hard?: uid }`), each uid
copied verbatim from Gelato's own catalogue in `BOOK_SIZES`
(`lib/photobook/spec.ts`) rather than constructed — see [Gelato](#gelato).
`productUidFor(sizeId, cover)` answers `null` where Gelato binds no such
book, and `sizesFor(cover)` is the list to offer for a chosen cover.

A hardcover's true panel and spine dimensions — not just its trim size — come
from Gelato's own cover-dimensions endpoint:
`GET https://product.gelatoapis.com/v3/products/{productUid}/cover-dimensions?pageCount=N&measureUnit=mm`.
Gelato rounds the page count up by 4 (endpapers, presumably) before it
answers, so the geometry for a 52-page book is quoted at 56. See
`lib/photobook/coverGeometry.ts`.

### Page-count rules

Printers bind in signatures; "any number of pages" is never true. What stood
here before was four providers' published ranges intersected by hand, every
row carrying `verified: false` because none had ever met an account — they
were wrong in both directions. A live probe against Gelato's product API on
2026-09-07 found one rule, the same for every photobook product it sells,
soft or hard, square or portrait:

| Min | Max | Multiple of |
| --- | --- | --- |
| 28 | 200 | 2 |

That is `GELATO_PAGE_RULE` in `lib/photobook/spec.ts`, and it is what the
planner now plans against. It is measured for Gelato only — the other three
providers' own limits have not been checked against this rule and may be
narrower.

Two consequences the planner handles rather than hides:

- **Too short.** A three-day trip is about fifteen pages of content against a
  twenty-eight page minimum. The planner first *grows* the book — breaking
  multi-photo pages into single-photo pages, largest groups first — and only
  pads with blanks when there is nothing left to spread out. When it does pad
  more than three pages, it says so — and says that a trip this short would
  want saddle stitch, which Gelato does not offer: it prints glued-left only,
  so there is no smaller-minimum product to fall back to.
- **Too long.** A 180-day trip does not fit in 160 pages. It becomes several
  volumes, split at chapter boundaries and never mid-day, each with its own
  title page ("Volume 2 of 3"), cover and spine width.

### The layout

Opinionated, not configurable. There is no template system, no theme layer and
no per-trip override, because there is one user and a template system is a way
of avoiding the decision rather than making it. The decisions, taken once, are
documented at the top of `lib/photobook/plan.ts`. In short: title, intro, a
route map running across a two-page spread, one chapter per country, one page
per day carrying that day's writing, the day's first photograph full bleed
without type on it, the rest in grids chosen by aspect ratio, a cost summary,
a colophon.

The route map is drawn as vectors from `lib/worldLand.json` — the same
simplified coastline the website's map uses — so the paper map and the screen
map are the same map, and it costs one file read rather than a tile server.

### The preview

`<trip>-preview.html` is built from the same page plan, with every rectangle
expressed as a percentage of the page instead of in points. It is not a second
layout engine: if a photograph is in the wrong place there it is in the wrong
place on paper. Open it before ordering anything.

### Ordering from the browser

A book no longer needs the CLI: the trip's photobook page has a Pay button
that spends the owner's credits, builds the same PDFs this section describes,
and mails links to them. `app/[user]/photobook/order/route.ts` calls no
provider — see [The comparison](#the-comparison) and its
[recommendation](#recommendation) for which one eventually will.
`app/[user]/photobooks/[id]/[file]/route.ts`, which serves those PDFs back to
the owner, is also the beginning of the reachable-URL requirement
[The fact that shapes the deployment](#the-fact-that-shapes-the-deployment)
describes: Gelato fetches a PDF from a URL rather than accepting an upload, and
this route is where that URL will eventually point.

### Retention (B483)

At 300 DPI one volume's interior and cover PDFs are tens to hundreds of
megabytes, and every order used to be kept forever — right so its mailed links
kept working, but "forever" was unqualified: nothing bounded the directory and
nothing pruned it, so the first symptom was a full disk.

**The policy: keep the newest orders, drop the rest's PDFs.** A journal's
`config.json` may carry `media.photobookOrdersPerUser` — how many *printed*
orders it keeps the interior/cover PDFs for, oldest dropped first. The
server's `site/config.json` (or a deployed instance's `FERNSCOUT_CONFIG`) may
set its own `media.photobookOrdersPerUser` as the ceiling every journal's own
value is narrowed against, the same composition every other `media` field
uses (`lib/mediaLimits.ts`). Shipped default: **20** — generous for how often
anybody actually orders a book, and enough to turn an unbounded directory into
a bounded one out of the box. `null` opts a journal out entirely and keeps
every book, same shape as the existing `perUserBytes` upload quota.
`/api/health`'s `photobook.keepOrdersPerUser` says what the instance is
currently configured to keep, so a caller can read the number before hitting
it rather than after.

**What actually happens, and when.** `pruneOldPhotobooks()`
(`lib/photobook/retention.ts`) runs once, right after an order finishes
printing (`app/[user]/photobook/order/route.ts`) — never before or during a
build, which is what keeps it from ever racing one: it only ever considers
orders already in `print_orders.status = 'printed'`, so an order still
`submitted` (a build in progress) is never a candidate, and the order that
just finished is always the newest `printed` row for that owner and therefore
always kept. Past the kept count, only the PDFs under
`content/<user>/photobooks/<orderId>/` are deleted — the `print_orders` row
survives untouched but for its `payload.files` (emptied) and a new
`payload.pruned: true`, so the price, the date and the page count stay real
history, and a page rendering that order stops offering a download that would
404. Nothing about an original photograph is touched: those live under the
trip's own `media/` and `originals/`, not under `photobooks/`.

**Not done, on purpose:** an owner is not mailed when an old order's files are
pruned. The rule is documented here and in `/api/health`, which is what
"the owner being told what the rule is" (B483's own words) asks for — a
per-deletion notice for a background-maintenance pass on paid-for-but-old PDFs
was judged not worth a second mail template. If that judgment turns out
wrong, `pruneOldPhotobooks()` is the one place to add it.

### Warnings the planner raises

All of them describe failures that are invisible on screen and obvious on paper:

- **`low-resolution`** — names the file, the printed width, the pixels needed
  and the DPI it will actually print at. The demo photos are 800–1400 px, which
  at full bleed is about 95 DPI and will look soft. Use the camera original.
- **`blank-padding`** — the book could not reach the minimum without empty
  leaves.
- **`split-into-volumes`** — how many volumes, and why.
- **`text-truncated`** — a day's writing is longer than its page.
- **`no-photos`** — the trip is text only.

A missing photograph is not a warning but a ruled box on the page naming the
file, because a silently blank page is the one error that survives all the way
to print.

---

## Colour: the honest position

Providers ask for **PDF/X (X-1a, X-3 or X-4), CMYK with an embedded ICC
profile, 300 DPI, ~3 mm bleed, embedded fonts, flattened transparency**. Here is
exactly where this pipeline stands against that, item by item. The same list is
written to `<trip>-pdfx.txt` on every run, and is generated by
`pdfxReadiness()` rather than typed, so it cannot drift from the truth.

| Requirement | Met | Why |
| --- | --- | --- |
| TrimBox and BleedBox on every page | ✅ | Written for every page, interior and cover |
| No transparency, annotations, JavaScript or encryption | ✅ | The writer has no operator that produces any of them |
| Info dictionary with `/Trapped`, plus an XMP packet | ✅ | Emitted whenever document options are passed |
| OutputIntent with an embedded ICC profile | ⚠️ **only with `--icc`** | Supply a profile and it is embedded as a real `DestOutputProfile`. Verified against macOS's Generic CMYK profile: a 55 KB CMYK profile lands in the file and `pdfinfo` parses it |
| All fonts embedded and subset | ❌ | The layouts use base-14 Helvetica, which every PDF consumer has and every part of PDF/X forbids. `pdffonts` reports `emb: no` |
| Colour is CMYK or spot only | ❌ | Content is DeviceRGB |

**No PDF/X version is stamped**, and `--icc` alone does not change that. The
flag is gated on every requirement being met, so a file that claims
`GTS_PDFXVersion` and then fails a preflight cannot be produced. A false claim
is worse than a documented gap, because the claim is what stops anyone checking.

### Why CMYK is not done natively

Converting an RGB photograph to CMYK needs a colour engine driving two ICC
profiles with a rendering intent and black generation. There is no correct way
to do that in a few hundred dependency-free lines. There *is* an incorrect way —
the naive `k = 1 − max(r,g,b)` conversion — which produces colours that look
plausible on screen and muddy on paper. Doing it badly would be worse than not
doing it, because the failure would only be discovered on printed paper.

Font embedding is achievable — a TrueType `FontFile2` with a `/FontDescriptor`
and a `/Widths` array is a day's work — but it would require vendoring a
licensed font file, and it does not on its own get the file to PDF/X while (2)
stands.

### The remedy, which is one command

Ghostscript closes both gaps in a single pass: `-dPDFX` embeds the base-14
fonts, converts DeviceRGB to the output intent's space, flattens what needs
flattening, and fails loudly on what it cannot fix.

```bash
npm run photobook -- --trip <user>/<trip-id> --icc /path/to/FOGRA39.icc
sh content/<user>/photobooks/gs-pdfx.sh   # needs: apt install ghostscript
```

`gs-pdfx.sh` and the `PDFX_def.ps` prologue it needs are both generated with
absolute paths already filled in, so the command is runnable as printed. This is
a **deploy-time** dependency, not a runtime one: it is not needed to produce a
book, only to produce one that satisfies the strictest preflight.

**None of this has been verified against a preflight tool.** There is no
Ghostscript, no veraPDF and no Acrobat on the machine this was written on, and
no account to submit a file to. What *has* been verified is that poppler
(`pdfinfo`, `pdffonts`, `pdftoppm`) parses the output, that the output intent
and its ICC stream are present and well-formed, that the fonts are reported as
not embedded, and that every page rasterises with the artwork where the plan
says it should be.

### The practical mitigation

Three of the four providers below accept RGB and convert it themselves. That is
not as good as controlling the conversion — their profile choice is theirs, not
yours — but it means the RGB gap blocks *nothing*. It changes a colour-critical
book from "impossible" to "order a proof first", which is advice this document
would give anyway.

---

## The four providers

**Gelato is measured; the other three are not.** A live probe against
Gelato's public quote API on 2026-09-07 confirmed its real product uids, its
page-count rule and real Swiss prices — see [Gelato](#gelato) below for
exactly what that probe did and did not reach. Peecho, Cloudprinter and Lulu
are unchanged: everything about them is still written from published
documentation and **has not been confirmed against a live account**. Get a
real quote from each before deciding anything.

### The fact that shapes the deployment

**All four fetch the PDF from a URL. None of them accepts an upload.** A
self-hosted book therefore needs to be reachable over HTTPS at an unguessable
address before a single order can be placed. That is an infrastructure decision
— a signed URL, a token in the path, a temporary object-storage link — and it is
much better made now than on the evening you want to order a Christmas present.
It is recorded in the type system as `transfer: "fetches-from-url"`, and a test
asserts it for all four.

### Peecho (acquired by Prodigi, 2024)

- **Endpoint:** `POST https://www.peecho.com/rest/v2/orders`
- **Auth:** API key in `X-API-Key`
- **Built:** `buildPeechoRequest()`
- Peecho's entire product is "someone made a PDF, now sell it as a printed
  book", which is this project's shape precisely. Netherlands-based, good
  European fulfilment, no minimum order, no monthly fee.
- **The open question:** since the Prodigi acquisition it is unclear which API
  survives. The Prodigi Print API (v4, `X-API-Key`,
  `https://api.prodigi.com/v4.0/Orders`) is better documented and should be
  checked first. If Peecho's own v2 has been frozen, port the builder — the
  payload shape is close.
- Products are addressed by a configured **offering ID** rather than a
  catalogue SKU, so an account must be set up with the trim size and page range
  before the first order.

### Gelato

- **Endpoint:** `POST https://order.gelatoapis.com/v4/orders` — **not yet
  confirmed against a live call.** Only the quote endpoint below has been.
- **Quote (measured):** `POST https://order.gelatoapis.com/v4/orders:quote` —
  its `recipient` object takes a `country` key. The create-order endpoint
  above uses `shippingAddress` instead; that shape has not been checked
  against a live call.
- **Auth:** API key in `X-API-KEY`
- **Products (measured):** `POST /v3/catalogs/{catalog}/products:search`.
  Real product uids are opaque catalogue strings copied verbatim into
  `BOOK_SIZES` (`lib/photobook/spec.ts`), e.g. for the square softcover:

  ```
  photobooks-softcover_pf_200x200-mm-8x8-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_250-gsm-100-lb-cover-coated-silk_ver
  ```

  `pageCount` travels as a **sibling field** on the order item, never as part
  of the uid — the builder used to build one by string concatenation
  (`photobook_pf_…-pages_…`), and that string matched no real product.
- **Page-count rule (measured):** every photobook product, soft and hard,
  square and portrait, accepts 28–200 pages in steps of 2 — see
  [Page-count rules](#page-count-rules).
- **Fulfilment (measured):** these books are produced in Switzerland
  (`productionCountry: "CH"`), which is the single fact that dominates the
  cost comparison below — Switzerland is outside the EU customs union and
  every book printed in the EU crosses a border on the way.
- **Shipment methods (measured):** `swiss_post_economy` (CHF 8.52, 4–7 days)
  and `swiss_post_priority` (CHF 10.64, 3 days). `shipmentMethodUid: "normal"`
  — what the builder used to hardcode — is not a value Gelato accepts.
- **Built:** `buildGelatoRequest()`. `BookOrder.productUid` and
  `.shipmentMethodUid` are now required fields the caller supplies; the
  builder no longer computes either.
- `orderType: "draft"` validates the files without printing, which is the
  closest thing it has to a sandbox — but this too is unconfirmed, since it
  lives on the create-order endpoint.

**Real prices, ex-VAT CHF, quoted 2026-09-07, one copy, printed in
Switzerland:**

| Pages | Softcover 200×200 | Hardcover 200×200 | Softcover 210×280 |
| --- | --- | --- | --- |
| 32 | 11.18 | 14.68 | 11.43 |
| 52 | 14.40 | 18.35 | 14.99 |
| 100 | 22.12 | 27.14 | 23.51 |
| 160 | 31.78 | 38.13 | 34.16 |

Every combination Gelato actually binds, at 52 pages — the pocket, and the
two sizes measured above only in one cover each:

| Size | Softcover | Hardcover |
| --- | --- | --- |
| Pocket 140×140 | 10.68 | — (no hardcover) |
| Square 200×200 | 14.40 | 18.35 |
| Portrait 210×280 | 14.99 | 19.81 |
| Large square 280×280 | — (no softcover) | 27.36 |

Shipping is CHF 8.52 (`swiss_post_economy`, 4–7 days) or CHF 10.64
(`swiss_post_priority`, 3 days) on top, per order rather than per copy.
**No order has ever been placed** — these are quote-endpoint prices, not a
confirmation that a create-order call with this shape succeeds.

### Cloudprinter

- **Endpoint:** `POST https://api.cloudprinter.com/cloudcore/1.0/orders/add`
- **Quote:** `POST /cloudcore/1.0/orders/quote`
- **Auth:** the API key travels **in the request body**, not in a header
- **Built:** `buildCloudprinterRequest()`
- A broker rather than a printer: it sits in front of a network of European
  printing partners and picks one. Two consequences worth knowing before
  choosing it. Page-count ranges and paper options are **per partner** rather
  than global, so the quote endpoint is the only honest source of what is
  possible. And the key in the body changes how it must be kept out of logs —
  the builder's `authHeaders` is deliberately empty and the value is the literal
  string `$CLOUDPRINTER_API_KEY`, so a fixture can be committed safely.
- Requires an **MD5 of each file**; it verifies what it downloaded against it.
  The CLI computes these and puts them in the request.

### Lulu

- **Endpoint:** `POST https://api.lulu.com/print-jobs/`
- **Sandbox:** `POST https://api.sandbox.lulu.com/print-jobs/`
- **Auth:** OAuth2 client credentials →
  `POST /auth/realms/glasstree/protocol/openid-connect/token`, then
  `Authorization: Bearer …`
- **Built:** `buildLuluRequest()` — `test: true` points at the sandbox
- **The only one of the four with a free sandbox**, and that makes it the right
  place to start regardless of who eventually prints the book. The sandbox
  accepts a real print job, runs the same file validation as production, and
  prints nothing. It is the only way to answer *"does my PDF pass preflight?"*
  without paying for a book — which is precisely the question this work package
  cannot otherwise answer.
- Products are addressed by a 27-character `pod_package_id` encoding trim size,
  colour, binding, paper, finish, lining and spine. It must be copied from
  Lulu's specification sheet, not guessed.

---

## The comparison

| | Peecho / Prodigi | Gelato | Cloudprinter | Lulu |
| --- | --- | --- | --- | --- |
| **PDF strictness** | Accepts RGB, converts | Accepts RGB, converts | Accepts RGB; strictest on file naming and MD5 | Wants PDF/X-1a; publishes the tightest spec of the four |
| **Validates before printing** | Order preflight | `orderType: "draft"` | Quote endpoint | **Free sandbox** |
| **EU fulfilment** | Good (NL-based network) | Best (largest network) | Good (EU partner network) | EU production (Poland) |
| **CH fulfilment** | Ships to CH; EU printed, so customs | **Likely printed in CH** — no border | Ships to CH; customs | Ships to CH; customs |
| **Minimum order** | 1 | 1 | 1 | 1 |
| **Subscription** | None | None (paid tier discounts) | None | None |
| **Per unit, 5–10 copies** | ≈ €18–25 | CHF 14.40–31.78 (measured, 52–160 pages, softcover) | ≈ €13–20 | ≈ €14–20 |
| **Shipping to CH** | €8–14 | CHF 8.52–10.64 (measured, per order, domestic Swiss post) | €8–14 | €10–16 + duty |
| **Auth** | Static key | Static key | Key in body | OAuth2 |
| **Env** | `PEECHO_API_KEY` | `GELATO_API_KEY` | `CLOUDPRINTER_API_KEY` | `LULU_CLIENT_KEY`, `LULU_CLIENT_SECRET` |

**Every price above is an estimate and must be replaced by a live quote.** They
are close enough to rank the four and nowhere near close enough to budget with.

### Recommendation

**Two providers, for two different jobs.**

1. **Validate with Lulu's sandbox.** It is free, it needs no card, and it is the
   only way to find out whether the PDF passes a real preflight before paying
   for anything. Do this first, and do it before spending any time on colour.
2. **Order from Gelato.** For delivery to Switzerland it is the only one of the
   four likely to print inside the country, and at 5–10 copies the customs
   handling on an EU-printed parcel costs more than the price difference
   between any two of them. If the recipients are in the EU rather than
   Switzerland, the ranking is much closer and Cloudprinter's quote is worth
   getting.

Peecho is the best conceptual fit and the one to revisit once the Prodigi
migration settles. Cloudprinter is the one to price against if volume ever goes
up.

---

## Go-live checklist

1. **Look at the preview.** `content/<user>/photobooks/<trip>-preview.html`. Every page,
   trim line and all. Nothing below matters if the layout is wrong.
2. **Read `<trip>-pdfx.txt`.** Know what you are sending before you send it.
3. **Fix the low-resolution warnings** by pointing the content at camera
   originals rather than web-sized copies. 95 DPI is soft enough to see.
4. **Create a Lulu account** (free) and get `LULU_CLIENT_KEY` /
   `LULU_CLIENT_SECRET`. Submit the interior and cover to the **sandbox** and
   read the validation errors. Fix them.
5. **Decide about colour.** Either accept the provider's own RGB→CMYK
   conversion and order a proof, or install Ghostscript and run
   `content/<user>/photobooks/gs-pdfx.sh` with the profile your printer names.
6. **Serve the PDFs.** All four fetch by URL. Decide now how a book gets a
   reachable, unguessable HTTPS address, and how it stops being reachable
   afterwards.
7. **Confirm every field name** against the chosen provider's current
   documentation. The builders are written from published APIs, and field names
   drift; the first order is the wrong moment to find out.
8. **Confirm the `pod_package_id` / offering ID / product code** for Peecho,
   Cloudprinter and Lulu from their live product APIs — Gelato's own
   `productUid` and page-count rule are already measured (see
   [Gelato](#gelato)), but its create-order request shape is not; confirm
   that too before the first real order.
9. **Get a real quote** for 5 and for 10 copies, delivered, including duty,
   for the three providers not yet measured. Replace their estimates in the
   table above.
10. **Order one copy. Look at it on paper.** Colour, gutter and crop cannot be
    checked on a screen. Only then order the rest.

---

## Not built, and why

| | |
| --- | --- |
| Ordering | Needs an account. The boundary this stops at |
| CMYK separation | Needs a colour engine. Documented above rather than done badly |
| Font embedding | Needs a vendored licensed font, and buys nothing while the file is still RGB |
| Payments / checkout | Out of scope — this is a tool, not a shop |
| Per-trip layout options | Deliberately absent. One user, one layout, no template system |
| Localised books | The book uses each entry's own prose. Per-locale editions would need the translation layer from W04 and a language switch in the colophon |
