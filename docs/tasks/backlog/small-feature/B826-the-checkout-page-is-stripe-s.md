---
id: B826
title: The checkout page is Stripe's grey, on a site that has a palette
type: FEATURE
priority: low
complexity: low
area: credits, payments, brand
found: "2026-09-07T15:45:00Z"
---

# B826 — The checkout page is Stripe's grey, on a site that has a palette

## Why

A buyer leaves a cream-and-navy travel journal and lands on a white page in
Stripe's own typeface with a black button. It is the one screen where somebody
is about to spend money, which is the worst screen to look like it belongs to
somebody else — and it is the screen most likely to be read as a phishing hop.

`branding_settings` on the Checkout Session does the whole of it from the API,
per session, so none of this needs the Stripe dashboard and none of it lives
outside git.

## Work

`branding_settings` in `createCheckoutSession`:

- `background_color` and `button_color` from `palette()` in `lib/brand.ts` —
  `cream-50` and `yellow-400`, read off `app/globals.css` rather than typed out
  again. B575 is why: a hex written down twice is a hex that disagrees with
  itself. A palette that cannot be read leaves both **omitted**, and Stripe
  uses its own default — no second copy anywhere, and no failure path that
  costs somebody a payment.
- `font_family: "nunito"`. Fredoka is not among Stripe's twenty-five, and
  Nunito is the nearest rounded sans in the list. Its unsupported-locale list
  (`el ja ko th zh`) does not touch the three this instance ships.
- `border_style: "rounded"`, which is what every card and button here is.
- `icon` as a **URL** rather than an uploaded file: `<site>/icon.svg`, which
  every instance already serves. An uploaded file would be a Stripe file id
  belonging to one account, in an env var, for a self-hostable product.
- `display_name` from `serverSite().name`, so an instance is named by its own
  config rather than by whatever the Stripe account is called.

Not doing: embedded Checkout or the Payment Element. Neither unlocks a single
styling option this does not (Stripe's customisation budget is the same either
way) and both would load `js.stripe.com` on our own domain, which contradicts
`site/legal/*.md` — "Nothing on these pages is loaded from anybody else's
server". The redirect is what keeps that sentence true.

## Acceptance

- A checkout session from this instance renders on cream, in Nunito, with the
  Fernscout mark, the journal's own name, and a yellow Pay button with dark
  text on it.
- Deleting `app/globals.css`'s colour tokens leaves a working, unbranded
  checkout rather than a failed payment.
