---
id: B1008
title: The print target is PDF/X-4 and the fonts are not embedded
type: ISSUE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-08T18:27:03Z"
started: "2026-09-08T19:11:41Z"
merged: "2026-09-08T19:43:13Z"
completed: "2026-09-09T16:47:04Z"
---

# B1008 — The print target is PDF/X-4 and the fonts are not embedded

## Why

`lib/photobook/pdfx.ts` reports readiness against **PDF/X-1a:2001** and calls
DeviceRGB a failure needing "a colour engine". `docs/providers/photobook.md`
repeats it as the uncomfortable thing about this writer.

Gelato's own downloadable template — `docs/providers/gelato-templates/` —
declares `GTS_PDFXVersion (PDF/X-4)`, and their support pages say the same:
export PDF/X-4, output intent GRACoL 2006. **PDF/X-4 permits RGB** with an
output intent, so the colour conversion this repository has been treating as
the blocker is not one.

What their template does that ours does not:

| | Gelato's template | ours |
| --- | --- | --- |
| PDF/X version | PDF/X-4 | none declared |
| Fonts | `KNFGCT+GelatoSans-Light`, embedded and subset | base-14 Helvetica, referenced |
| OutputIntent | present | absent |
| Colour | RGB, permitted under X-4 | RGB |

So the real gap is **font embedding**, and after that an output intent and the
X-4 identification. Not a colour engine.

This matters because it is the last thing standing between us and a real
order. A printer substitutes a font it does not have, and nobody finds out
until the parcel arrives.

## Work

- Retarget `pdfx.ts` at PDF/X-4: RGB stops being a failure, and the report
  stops recommending a Ghostscript CMYK conversion nobody should run. Done —
  `pdfxReadiness()` now targets `"PDF/X-4"` and the colour requirement reads
  "RGB or CMYK with a matching output intent".
- Embed the interior and cover fonts. **Decision: embed whole, do not
  subset.** `lib/postcard/pdf.ts` now embeds Liberation Sans (metric-compatible
  with Helvetica, so no already-laid-out book moves) as a real `FontFile2` per
  face, read via `lib/postcard/truetype.ts`'s new metrics reader. Ghostscript
  was ruled out as the subsetting/CMYK route — it is not installed on this
  machine and adding it is a deployment dependency this repository has
  deliberately avoided elsewhere. A hand-rolled TrueType *subsetter* (rebuilding
  `glyf`/`loca`/`cmap`/`hmtx` for only the glyphs used) was judged out of scope
  for this ticket: the acceptance line only asks for `emb: yes`, which whole
  embedding already satisfies, and a real subsetter is its own piece of work.
  Captured as B1017.
- Emit `/OutputIntent` with an ICC profile and the `GTS_PDFXVersion` key. The
  CLI already accepted `--icc`; the web order path (`lib/photobook/build.ts`)
  now reads a `PRINT_ICC_PROFILE` environment variable so a book ordered from
  the button claims the same PDF/X-4 as one built from the CLI. Both paths
  covered.
- Correct `docs/providers/photobook.md`, which framed the colour space as the
  problem. Done — the "Colour: the honest position" section, the go-live
  checklist, the provider comparison table and the "Not built, and why" table
  all now describe PDF/X-4 as the target and fonts as embedded (not subset),
  with Ghostscript demoted to "only if a provider's own preflight still wants
  CMYK regardless of what X-4 permits".

## Acceptance

- `pdffonts` on a generated interior and cover reports every font `emb yes`.
  **Met** — verified on `content/example/photobooks/alps-2024-{interior,cover}.pdf`
  built via `npm run photobook -- --trip example/alps-2024 --icc
  "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc"`: all three
  faces report `emb yes` (`sub no` — see B1017).
- The file declares PDF/X-4 and carries an output intent. **Met** — the same
  file's Info dictionary and XMP packet both carry
  `GTS_PDFXVersion (PDF/X-4)`, and the Catalog carries a real `/OutputIntents`
  entry with an embedded `DestOutputProfile`; confirmed by reading the raw PDF
  bytes (`strings … | grep GTS_PDFX`) since `pdfinfo` does not surface a
  custom Info key by default.
- One real order is promoted at Gelato and prepress accepts it. **Outstanding
  — cannot be closed by an agent.** It needs a real payment method and a real
  shipping address, neither of which exists on the account behind
  `GELATO_API_KEY` in this environment. Everything else this ticket asked for
  is built and verified locally; this line is for a person to run once those
  two things exist.
