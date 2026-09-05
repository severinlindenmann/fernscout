---
id: B435
title: No print provider can actually post a card — print.one is unevaluated and unwired
type: FEATURE
priority: high
complexity: medium
area: postcards
found: "2026-09-05T10:12:20Z"
---

# B435 — No print provider can actually post a card — print.one is unevaluated and unwired

## Why

`lib/postcard/providers.ts` offers three names and only `dry-run` works.
`stannp` is a request builder written from published docs and never called;
`swisspost` is documented as unusable. The owner's preference is **print.one**,
on pricing.

It is unevaluated in a way that matters to B434's design. print.one's public
documentation is a JavaScript app that returns an empty page to a fetch, and
the only description available describes a **template plus merge-variables**
model — design the card in their drag-and-drop editor, send JSON values. B434
assumes the opposite: that we upload the PDF `lib/postcard/render.ts` already
produces, which is what makes the preview page show the exact bytes that get
printed.

If print.one will not take a custom file, that assumption dies and the preview
becomes their render embedded in our page. **Nobody has checked**, and building
the provider before checking is building the wrong one.

## Work

1. **Probe first, timeboxed.** With a real key against their sandbox: does an
   order accept an uploaded PDF or custom file, or only a `templateId` with
   variables? What does an order request and response look like? Is there a
   test mode that costs nothing? What are the A6 format and finish values?
   Write the answers into `docs/providers/postcards.md` before any code.
2. If PDF upload exists: add `printone` to `ProviderName` and a
   `buildPrintOneRequest` beside `buildStannpRequest`, plus a client that
   actually posts, unit-tested against recorded fixtures.
3. If it does not: stop, report, and reopen the rendering decision on B434
   rather than quietly switching the preview to somebody else's image.
4. `PRINTONE_API_KEY` in the environment only, never `content/config.json`.
   `availableProviders()` reports it unready without one; the default provider
   stays `dry-run` so a fresh clone still works with no account.

**Not doing:** posting a real card. That is B437.

## Acceptance

- `docs/providers/postcards.md` answers the four probe questions with something
  observed, not something inferred from marketing copy.
- `npm run postcard -- --providers` lists `printone` with an honest ready/not
  and a reason.
- Unit tests build a print.one order request from fixtures and assert the
  payload shape; no test reaches the network.
- With `PRINTONE_API_KEY` unset, the provider refuses rather than half-running,
  and `dry-run` is unaffected.

## Blocks

B434's rendering choice, and B437 entirely.
