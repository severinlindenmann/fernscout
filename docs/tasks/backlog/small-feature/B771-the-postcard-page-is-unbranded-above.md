---
id: B771
title: The postcard page is unbranded above the send block, unlike every page the photobook shows
type: FEATURE
priority: medium
complexity: low
area: postcards, brand
found: "2026-09-07T00:00:00Z"
---

# B771 — The postcard page is unbranded above the send block, unlike every page the photobook shows

## Why

Asked for after the photobook's own pass: *"can you also bring the same feel
and look to the postcard generator?"*

`/[user]/postcards/[id]` is where an owner looks at a card and decides to spend
credits on it, and it is dressed in nothing. `rounded border`, `opacity-70`,
`text-black/50`, `text-lg font-semibold` — four brand tokens in 565 lines, all
four of them inside the send block, which got its own pass when the money
moved there. Everything above it is the unstyled default: the heading is not
`font-display`, the notices are a grey box rather than the yellow panel every
warning on the photobook page uses, the message form's inputs are hairline
grey, and the save button is a bordered rectangle where every other action on
the site is a pill.

The comparison is direct and it is what prompted this:
`BookLevelView.tsx` carries 22 brand tokens; this page carries 4.

Nothing here is a layout problem. The page's *structure* — the two cards side
by side, the message form under them, the recipients, then the one button that
spends — is right, and the reasoning behind each part is written down in the
file. It is the surface.

## Work

- The photobook composer's own vocabulary, applied to the page above the send
  block: `font-display` headings in `navy-900`, secondary type in `navy-600`,
  the warning panel for every notice (`border-yellow-300 bg-yellow-50
  text-yellow-900`), `rounded-lg border border-navy-200 bg-white` for the
  message form, pill buttons with `min-h-11`, and inputs that match the
  settings panel's.
- Mobile first, as the photobook's flow now is: a save button that is a real
  tap target, inputs that fill the width at 390px.
- Not doing: the structure, the copy, or the send block, which is already
  dressed and is the one thing on this page that has been thought about
  twice. Not doing `/[user]/contacts` either — it carries *zero* brand tokens
  and is the same fault one page over, but it is a separate capture.

## Acceptance

- No `opacity-70`, `text-black/50` or bare `rounded border` left on the page.
- Looked at in a browser at 390px and at desktop width against the photobook
  composer, per `test-in-a-browser`: the two pages read as one product.
