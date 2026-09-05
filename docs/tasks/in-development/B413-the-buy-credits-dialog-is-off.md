---
id: B413
title: The Buy-credits dialog is off-centre; make it an animated dropdown under its button
type: ISSUE
priority: low
complexity: low
area: me page, credits, design
found: "2026-09-05T10:20:00Z"
started: "2026-09-05T08:27:37Z"
session: 3d8b93dd-e447-4c3c-bcd1-fa37e2bd17f9
claimed: "2026-09-05T08:27:37Z"
---

# B413 — The Buy-credits dialog is off-centre; make it an animated dropdown under its button

## Why

The "Guthaben kaufen" tier picker (`BuyCreditsDialog` in
`app/[user]/me/MePageContent.tsx`, B368) is a native `<dialog>` opened with
`showModal()`. In the owner's browser it renders top-left rather than centred —
a modal `<dialog>` centres via the browser default, but that breaks when an
ancestor establishes a containing block (a `transform`/`filter`/`contain` on a
parent pulls the fixed-positioned dialog out of the viewport centre).

The owner would rather it were not a centred modal at all: a small dropdown that
opens **underneath the button**, animated, reads better for a three-item picker
than a full-screen modal. That also sidesteps the centring bug — an anchored
popover positions against its button, not the viewport.

## Work

Rebuild `BuyCreditsDialog` as an anchored dropdown, in
`app/[user]/me/MePageContent.tsx`:

- Wrap the button in a `relative` container; render the panel `absolute`,
  `top-full`, left-aligned to the button, `z`-above the card, width capped so it
  never exceeds the card on mobile (`w-[min(22rem,100%)]` or similar).
- Animate open: fade + a short downward slide (e.g. opacity 0→1, `translateY`
  -4px→0, ~150ms), and respect `prefers-reduced-motion` (no transform when
  reduced).
- Keep it keyboard- and pointer-usable: `aria-expanded` on the button, Escape
  closes, a click outside closes, focus returns to the button on close. It is a
  disclosure of three actions, not a trap — a menu/popover pattern is right.
- Preserve the B405 behaviour exactly: each tier's Buy posts to the purchase
  route and, on success, navigates to the returned `paymentUrl` (the email
  carries the same link). No change to the route, the tiers, or the copy.
- The three tiers keep their current look (cream rows, yellow Buy button,
  credits + price + discount).

## Acceptance

- `npm run verify` green.
- `test/access-panel.test.tsx` (the payment-section tests) still pass, updated
  only if the trigger's markup changed in a way a test pins.
- By eye at 375px and desktop: pressing "Guthaben kaufen" opens a panel directly
  under the button, animated, not a centred/off-centre modal; Escape and
  click-outside close it; the three tiers and their Buy buttons still work and
  still lead to the payment page.
