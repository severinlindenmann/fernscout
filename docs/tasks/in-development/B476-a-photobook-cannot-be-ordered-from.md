---
id: B476
title: A photobook cannot be ordered from the site, only from a shell
type: FEATURE
priority: high
complexity: high
area: photobook, credits, gallery
found: "2026-09-05T13:49:29Z"
started: "2026-09-05T13:56:01Z"
session: d9c396ea-a80a-4f80-954a-d37a0bf2c8c8
claimed: "2026-09-05T13:56:01Z"
---

# B476 — A photobook cannot be ordered from the site, only from a shell

## Why

`lib/photobook/` plans, lays out and renders a complete print-ready book, and
in the whole life of the project nobody has made one. The reason is the same
one B434 found for postcards: using it needs `npm run photobook -- --trip
<ref>` at a shell on the server. The missing piece was never the rendering.

It also blocks the provider work. Gelato is the chosen provider — the research
is in `docs/superpowers/specs/2026-09-05-photobook-ordering-design.md`, and
`docs/providers/photobook.md` carries the four builders — but connecting a
printer to a pipeline no person has ever driven end to end would be paying to
find out that the book is not the book they wanted.

## Work

Design: `docs/superpowers/specs/2026-09-05-photobook-ordering-design.md`.
Plan: `docs/superpowers/plans/2026-09-05-photobook-ordering.md`, eleven tasks.

In short: a *Fotobuch erstellen* button in the gallery beside *Postkarte
senden*, owner only, leading to an options page — format, binding, which
photographs, and whether the writing, the route map, the chapter dividers, the
names and the costs are in the book. The preview is `renderPreview` over the
real page plan, so it cannot drift from the paper. Pay spends real credits,
builds the PDFs and mails links to them.

**Not doing:** no provider call, no cover editor, no hardcover, no agent-facing
API, no job queue. `photobook` moves to `db: true`; `SpendReason` gains
`"photobook"`; the credit price is a placeholder carrying
`PHOTOBOOK_PRICING_VERIFIED = false` until Gelato's price endpoint answers.

## Acceptance

- `npm run verify` passes.
- The gallery shows the button for the owner and for nobody else, and not at
  all when `photobook` or `credits` is off.
- Toggling any option changes the preview and the page count, and the price
  follows the page count.
- Pressing Pay twice charges once.
- A failed build refunds in full and says so.
- An `.eml` under `content/<user>/mail/` links to two PDFs that open, and says
  nothing was printed or posted.
