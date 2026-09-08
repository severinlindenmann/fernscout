---
id: B772
title: The contacts page carries no brand tokens at all
type: CHORE
priority: low
complexity: low
area: contacts, brand
found: "2026-09-07T00:00:00Z"
started: "2026-09-08T05:46:12Z"
merged: "2026-09-08T05:50:42Z"
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

## Findings (2026-09-08) — nothing to do, and why

**The measurement was taken on the wrong file.** `app/[user]/contacts/page.tsx`
is a 225-line shell: it resolves the owner, decrypts the contacts and hands
them to `ContactsAdmin`. It carries zero brand tokens because it renders almost
no markup. The page is `components/ContactsAdmin.tsx`, and that file carries
**97**: 30 `navy-900`, 17 `navy-200`, 12 `navy-700`, 8 each of `navy-600`,
`navy-500` and `font-display`, 12 `cream-*`, 2 `yellow-400`. Its whole palette
is `navy`, `cream`, `coral` and `yellow` — no `gray-`, no `slate-`, no
`text-black`, no `opacity-70`, no bare `rounded border`. None of B771's four
tells is present. `git log` shows no branding pass since; it was always
dressed.

**Looked at, per `test-in-a-browser`.** Signed in as the owner against a local
checkout with `contacts` on, at 390 × 844 and at 800: cream page, `font-display`
headings in navy, white cards with `navy-200` borders and rounded corners,
pill buttons (outline for "Add your details", solid navy for "Add a guest" and
"Create the link"), inputs matching the rest. It reads as the same product as
the photobook composer.

`document.documentElement.scrollWidth` is 390 at 390, and no element in `main`
extends past the viewport — a first pass with `--window-size` appeared to clip
the copy and that was a screenshot artifact, measured rather than believed.

**No code changed.** Left for a person to close: the ticket describes a fault
that is not there.
