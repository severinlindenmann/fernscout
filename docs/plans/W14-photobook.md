# W14 — Photobook layout + PDF/X + provider preparation

**Roadmap:** H1, H2, H3, H4 · **Depends on:** W03 (and W13's pipeline) · **Wave G**

## Goal
A trip becomes a print-ready book. Script-first, for you — but able to produce
5–10 copies (decision 8). No checkout, no payments.

## Scope

### Print correctness — the actual hard part
Providers require **PDF/X (X-1a, X-3 or X-4), CMYK with embedded ICC, 300 DPI,
~3 mm bleed, embedded fonts, flattened transparency**. HTML→PDF via headless
Chrome produces **RGB** and gets rejected or colour-shifts.

Path: server-side layout → PDF → CMYK conversion via Ghostscript/littlecms, or
a library that emits PDF/X directly. **Decide by experiment, not by reading.**
Reuse whatever W13 proved.

### Layout engine (H1)
Trip → page plan: cover, route map spread, chapters per country, photo grids
sized by aspect, captions, cost summary if enabled, colophon. **Opinionated, not
configurable** — one user means no template system, which removes most of the
difficulty.

### Preview (H3)
For a script this is "open the PDF" plus a low-res web preview from the same
layout data. Nearly free at this scope.

### Provider preparation (H4) — document, don't call
**Peecho** (acquired by Prodigi 2024), **Gelato**, **Cloudprinter**, **Lulu**.
Write request builders + fixtures. `docs/providers/photobook.md` records
endpoints, auth, file requirements, trim sizes, page-count rules, pricing and
what account is needed. Compare on: PDF spec strictness, EU/CH fulfilment,
minimum order, per-unit cost at 5–10 copies.

## Stop line
Stop when an API key is the only thing missing. **Print one physical proof via
a manual upload before trusting the pipeline** — colour is not verifiable on screen.

## Acceptance
- [ ] A trip produces a valid PDF/X that a preflight tool accepts
- [ ] CMYK conversion verified with an ICC profile, not assumed
- [ ] Bleed/trim/safe area correct on every page type
- [ ] Page count obeys provider rules (multiples, minimums)
- [ ] Both provider docs written with a go-live checklist
- [ ] Preview matches the PDF
