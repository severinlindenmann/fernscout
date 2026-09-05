---
id: B434
title: A postcard cannot be ordered from the site — only rendered by hand on a shell
type: FEATURE
priority: high
complexity: high
area: postcards, credits
found: "2026-09-05T10:12:07Z"
---

# B434 — A postcard cannot be ordered from the site — only rendered by hand on a shell

## Why

`lib/postcard/` renders print-ready A6 fronts and backs, `lib/contacts` already
holds approved readers who left a postal address and ticked *send me a real
postcard*, and `lib/credits.ts` already meters sends. None of it is reachable
except through `npm run postcard`, which needs a shell on the server and a
recipient JSON file typed by hand — so in practice nobody has ever ordered one.

The gap is an **order**: something an agent can build from a day and a photo,
that a person can look at, price and press Send on. There is no object for it
today, so there is nothing for the preview page to render and nothing for the
`spend` to refer to.

Design: `docs/superpowers/specs/2026-09-05-postcard-orders-design.md`.

## Work

- Migration `021-postcard-orders.ts`:
  - `postcard_orders` — `id, owner_id, trip_ref, day_slug, photo, message,
    sender, status, credits_each, created_at, expires_at, sent_at, provider,
    error`.
  - `postcard_recipients` — `id, order_id, contact_id, status, provider_ref`.
    A **`contact_id`, never a copied address**: addresses stay encrypted in
    `lib/contacts`, in one place, and are read at render and at send.
  - `status`: `draft → sent | failed | expired`. Orders expire after 7 days.
- `POSTCARD_CREDITS = 15` in `lib/credits/pricing.ts` (plain data — the preview
  page renders the price and `lib/credits.ts` is `server-only`).
  `SpendReason` gains `"postcard"`.
- `lib/postcard/orders.ts` — create, read, claim, expire.
- Routes, agent-facing:
  - `GET /api/v1/<user>/postcards/recipients` — name, city, country. **Never
    the street.** An agent has no reason to hold somebody's front door.
  - `POST /api/v1/<user>/postcards` — `{trip, day, photo, message,
    recipients:[contactId], from}` → `201 {id, url, credits:{each,total,balance},
    warnings}`. Costs nothing.
  - `GET /api/v1/<user>/postcards/<id>` — status.
- **No send route reachable by an agent token.** Not owner-checked — absent,
  the way `grant()` has no HTTP caller. Sending is a form POST from the page.
- Page `/<user>/postcards/<id>`, owner session only, **404 to everyone else**
  so the page never confirms an id exists. Rendered front and back as images
  (from the real print PDF, cached beside the order), recipients as name + city
  with the full address behind a disclosure, `15 × n` against the balance, a
  Buy-credits link when short, one Send button.
- Send, in this order, modelled on `send-mail/route.ts`:
  1. Claim — `UPDATE … SET status='sent' WHERE id=? AND status='draft'`. Zero
     rows affected is the double-click guard; the second press is told the
     cards are already on their way and charges nothing.
  2. `spend(owner, 15 × n, "postcard", orderId)` — all-or-nothing. Refused
     puts the row back to `draft`, answers `402`, prints nothing.
  3. Hand each card to the provider; refund per-card failures.
- A6 at 300 DPI with bleed needs **1819 × 1312 px** and `media/` derivatives cap
  at 2000 px on the long edge: landscape just clears it, **portrait does not**.
  The page carries a `low resolution` warning rather than printing soft.

**Not doing:** editing the photo, message or recipient list on the page. It is
confirm-only; changing any of them is a sentence to the agent, which is where
editing lives everywhere else here. Not doing a real provider send either —
that is B435 and B437.

## Acceptance

`test/postcard-orders.test.ts` covers, and fails today:

- Two Sends on one order charge once and print once.
- A balance short of `15 × n` prints nothing, charges nothing, answers `402`.
- A non-owner opening the preview page gets `404`, not `403`.
- No route an agent-scoped token can reach moves an order out of `draft`.
- An order past `expires_at` refuses to send.
- `GET …/postcards/recipients` returns no street, on any recipient.

And by hand: `npm run postcard` still works unchanged, and the whole flow above
runs end to end against the `dry-run` provider with no account.
