---
id: B772
title: The contacts page carries no brand tokens at all
type: CHORE
priority: low
complexity: low
area: contacts, brand
found: "2026-09-07T00:00:00Z"
---

# B772 — The contacts page carries no brand tokens at all

## Why

Noticed while doing B771 to the postcard page, and captured rather than
absorbed. `app/[user]/contacts/page.tsx` matches `navy-`, `cream-`, `yellow-`
and `font-display` **zero** times — the postcard page at least had four. It is
an owner-only page that shows addresses, invite links and the approval queue,
so it is not somewhere a person spends long, but it is a page of this product
wearing none of it.

## Work

- The same pass B771 makes on the postcard page: headings in `font-display`
  and `navy-900`, the yellow panel for notices, pill buttons, inputs that
  match the rest.
- Read B771's findings first — whatever it settles about which panel is which
  is the answer here too, rather than a second set of decisions.

## Acceptance

- The page reads as the same product as `/[user]/photobook`, checked at 390px.
