---
id: B1411
title: a payment abandoned at Stripe leaves the checkout page with no way to pay again
type: ISSUE
priority: high
complexity: low
area: credits / payments
found: "2026-09-10T20:05:26Z"
---

# B1411 — a payment abandoned at Stripe leaves the checkout page with no way to pay again

## Why

Reported from the live site. Somebody pressed Pay on `/<user>/payment/<id>`,
landed on Stripe, changed their mind and came back. The page now reads:

> Zahlung abschliessen — 200 Guthaben-Punkte — CHF 35.18
> Status: **Warten auf Freigabe**
> Zahlung wird bestätigt
> Von Stripe kam noch keine Bestätigung. Wenn du bezahlt hast, erscheinen deine
> Credits gleich hier — dieser Link zeigt immer den aktuellen Stand.

There is no Pay button and no other control. The page is telling somebody who
paid nothing that their payment is being confirmed, and offering them no way to
start it. The only escape is filing a second purchase, which leaves an
abandoned row behind.

The cause is in the page, not the route. `pay()` in
`components/PaymentCheckout.tsx:51` posts to the pay route, which calls
`submitRequest` and moves the row to `requested` *before* the redirect
(`app/api/v1/[user]/payments/[id]/pay/route.ts`, the Stripe branch). Back on
the checkout page, `requested` at line 88 renders the confirming/not-settled
panel at line 158 and the whole button block at line 176 is the `else` — so a
row that has been *offered* a session is indistinguishable, to this page, from
one that has been paid at Stripe and is awaiting the webhook.

The route is already fine with a second press: B831 made it reuse an open
session and mint a fresh one otherwise. Only the page refuses to ask.

Note also that the copy under `pay.notSettled` asserts a payment is being
confirmed when nothing was charged — the same class of untrue sentence
AGENTS.md's helper net exists to stop, one page over.

## Work

- Let the checkout page offer Pay again on a `requested` row that has not
  settled — the route already handles the second press.
- Distinguish "came back from Stripe having paid" (`?returned=1`, poll, keep
  the confirming panel) from "on this page with a `requested` row and no
  evidence of payment" (offer Pay, with wording that does not claim a payment
  is in flight). `returned` is already read at line 96.
- Not doing: any change to `submitRequest`, to session reuse, or to when the
  row moves to `requested`. Not doing: cancelling or expiring the Stripe
  session on return.
- German and English wording both need to be true of the state they describe.

## Acceptance

Start a purchase on the live site, land on Stripe, press its back link, and the
checkout page offers Pay again and pressing it returns to a Stripe page. A
buyer who has actually paid still sees the confirming panel and still gets
their credits when the webhook lands. Neither state tells somebody a payment is
being confirmed when none was made.
