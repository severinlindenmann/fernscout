# Photobook providers

What is built, what deliberately is not, and exactly what is needed to go live.

**Status: everything up to the account boundary is done.** A trip becomes a
planned, laid-out, print-ready book with a cover and a preview, and all four
provider request builders are written and tested against fixtures. Nothing
calls a provider, because calling one needs an account — and that is where this
work package was told to stop.

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
npm run photobook -- --trip <user>/<trip-id> --binding saddle     # short trip: staples, not glue
npm run photobook -- --trip <user>/<trip-id> --size landscape-a4
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
| Default size | Square 210 × 210 mm — every one of the four providers lists it, and neither photo orientation is second class |
| Also available | A4 landscape (297 × 210), A4 portrait (210 × 297) |
| Bleed | 3 mm on all four edges → media box 216 × 216 mm (612.28 pt square) |
| Outer margin | 10 mm inside the trim |
| Gutter | **16 mm** at the spine — wider than the outer margin, because a perfect-bound book does not open flat and the first few millimetres curve away from the reader |
| Resolution | 300 DPI. A full-bleed square photo therefore needs **2551 px** |
| Handedness | Page 1 is a recto. The gutter alternates from there, and the layout knows which hand it is on |
| Spine | `pages / 2 × 0.115 mm` — leaves, not pages. Get this wrong and the front image creeps onto the spine |
| Boxes | `TrimBox` and `BleedBox` on every page, including the cover |

### Page-count rules

Printers bind in signatures; "any number of pages" is never true. The book is
planned against the **intersection** of all four providers, so choosing one
later does not mean re-laying it out:

| Binding | Min | Max | Multiple of |
| --- | --- | --- | --- |
| Perfect bound (default) | 32 | 160 | 4 |
| Saddle stitch (`--binding saddle`) | 4 | 48 | 4 |

The per-provider numbers those come from are in `BINDING_PROFILES`
(`lib/photobook/spec.ts`), each carrying `verified: false`, because they are
read from published documentation and not from an account. A unit test asserts
that flag, so confirming one against a live API means changing the flag and
noticing.

Two consequences the planner handles rather than hides:

- **Too short.** A three-day trip is about fifteen pages of content against a
  thirty-two page minimum. The planner first *grows* the book — breaking
  multi-photo pages into single-photo pages, largest groups first — and only
  pads with blanks when there is nothing left to spread out. When it does pad,
  it says so, and it says that saddle stitch is the right answer instead.
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

Everything in this section is written from published documentation and **has not
been confirmed against a live account**. Prices especially: they are order-of-
magnitude figures for a 52-page 210 × 210 mm colour softcover, and every one of
these APIs has a quote endpoint that will give a real number in one call once a
key exists. Get the real number before deciding anything.

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

- **Endpoint:** `POST https://order.gelatoapis.com/v4/orders`
- **Auth:** API key in `X-API-KEY`
- **Products:** `GET https://product.gelatoapis.com/v3/…`; prices at
  `/v3/products/{productUid}/prices`
- **Built:** `buildGelatoRequest()`
- The widest production network of the four, and the only one plausibly able to
  print **inside Switzerland**. That single fact dominates the cost comparison
  below, because Switzerland is outside the EU customs union and every book
  printed in the EU crosses a border on the way.
- `orderType: "draft"` validates the files without printing, which is the
  closest thing it has to a sandbox.
- The `productUid` in the builder has the right *shape* and is not a real id.
  It must come from the live product API — this is the first thing to verify.

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
| **Per unit, 5–10 copies** | ≈ €18–25 | ≈ €16–22 | ≈ €13–20 | ≈ €14–20 |
| **Shipping to CH** | €8–14 | often domestic | €8–14 | €10–16 + duty |
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
8. **Confirm the page-count rule and the `productUid` / `pod_package_id` /
   offering ID** from the live product API. Then set `verified: true` on that
   binding profile in `lib/photobook/spec.ts`.
9. **Get a real quote** for 5 and for 10 copies, delivered, including duty.
   Replace the estimates in the table above.
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
