---
id: B368
title: There is no way to ask for more credits, and the payment provider does not exist yet
type: FEATURE
priority: low
complexity: medium
area: credits, payments
found: "2026-09-04T21:03:12Z"
---

# B368 — There is no way to ask for more credits, and the payment provider does not exist yet

## Why

After B366 an owner at zero credits cannot send. After B367 they can see that.
Neither gives them anything to do about it: credits enter only through `npm run
credits -- grant`, which needs a shell on the box.

The owner's decision is to build the **front half now and the payment provider
later** — the button, the tiers, the confirmation and the mail, with a link
that lands on a page saying payment is not live yet. That is deliberately a
mock, and it is worth building as one: the shape of the offer (what tiers, what
discount, what the confirmation says) is the part that needs looking at on a
screen, and it does not need a PSP to be looked at.

## Work

### The tiers

Base price **CHF 0.20 per credit**, with a volume discount:

| Credits | Discount | Price |
| --- | --- | --- |
| 50 | — | CHF 10.00 |
| 100 | 10% | CHF 18.00 |
| 200 | 20% | CHF 32.00 |

One `const TIERS` in `lib/credits.ts` (or a `lib/credits/pricing.ts` if that
file is already long), each row carrying credits, price in **integer rappen**,
and the discount as a display string. Never a float for money; never a price
computed in the component. Nothing charges a card yet, so these are trivially
editable later — which is the argument for putting them in code rather than in
`content/config.json`, where they would be an operator switch nobody asked for.

### The overlay

A **Buy credits** button in B367's Payment panel, opening a modal listing the
three tiers with credits, price and discount. Pressing Buy on one:

1. `POST /api/v1/<user>/credits/purchase` with the tier — owner only, and by
   the same gate every other owner-only route uses (`isOwner`,
   `lib/contacts/session.ts:29`). B240 is open on owner gates being one scope
   string away from opening; do not invent a new check here.
2. The route mails the address in the journal's own `config.json` — never an
   address from the request — through `sendTransactional`
   (`lib/mail/index.ts`), rendered with `renderMail`
   (`lib/mail/template.ts`) like every other letter. Subject and body carry the
   tier, the credit count and the price.
3. The mail contains a link to `/<user>/credits/pay/<tier>`, a page that says
   payment is not available yet and to contact the operator. It takes no money,
   sets no cookie, and grants nothing.
4. The overlay closes to **"Payment info sent to your mail"** — that exact
   claim and no stronger. It must not say "purchased", "ordered" or
   "processing", because nothing was.

Accessible modal basics — focus trapped, Escape closes, the button labelled.
Follow whatever `ContactManage` / `AgentHandover` already do rather than
inventing a dialog primitive; if nothing here does modals yet, `<dialog>` with
`showModal()` is the native answer and needs no dependency.

### The rule this ticket exists to not break

**The purchase route grants nothing.** It sends a mail. It does not import
`grant`, it does not touch `credits.balance`, it does not write a ledger row.
B366's acceptance includes a test that no file under `app/` imports `grant`
from `lib/credits`; this ticket is the one most likely to break it, so run it.

Rate-limit the route — one purchase mail per owner per minute is generous. It
is authenticated and owner-only, so this is about a stuck client looping, not
an attacker; whatever throttle `/api/auth/request` already uses is the thing to
reuse.

The purchase mail is **transactional and therefore free** — it goes to the
owner about their own account, not to readers, and B366's rule is that only
`sendDayLetter` and `sendDayWhatsapp` charge. Do not let it debit.

### Not in this ticket

- Any payment provider, checkout session, webhook, card, invoice or receipt.
  The link is dead on purpose and the page says so.
- An orders table. There is no order — a mail was sent. When a real PSP lands
  it will want its own row shape, and guessing that shape now is a schema
  migration written against a provider nobody has chosen.
- Automatic granting on payment. That is the same later ticket.
- Custom amounts, subscriptions, auto-top-up.

## Acceptance

- `npm run verify` green, `npm run unused` clean.
- `test/credits-purchase.test.ts`:
  - A guest, a traveller and an unauthenticated caller each get `403` from
    `POST /api/v1/<user>/credits/purchase`; the owner gets `200`.
  - A `200` writes exactly one `.eml` under `content/<user>/mail/` and leaves
    the balance and the ledger **unchanged** — asserted, because it is the
    whole point of the ticket.
  - An unknown or absent tier is `400`, and sends nothing.
  - The mail goes to `config.json`'s owner address even when the request body
    names a different one.
- By hand with `MAIL_TRANSPORT=file`: press Buy on each tier, confirm the
  overlay says info was mailed, open the `.eml`, follow the link, and land on a
  page that says payment is not live yet.
