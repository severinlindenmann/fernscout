---
id: B405
title: A mock payment page with a transaction, status and TWINT/card options, emailed as a come-back-later link
type: FEATURE
priority: medium
complexity: high
area: credits, payments
found: "2026-09-05T09:50:00Z"
started: "2026-09-05T07:49:47Z"
session: 3d8b93dd-e447-4c3c-bcd1-fa37e2bd17f9
claimed: "2026-09-05T07:49:47Z"
---

# B405 — A mock payment page with a transaction, status and TWINT/card options, emailed as a come-back-later link

## Why

B368 built the front half: a Buy-credits overlay and a `POST .../credits/purchase`
that mails a link to a page saying "payment is not live yet". The owner wants
that page to be a real (still mock) **payment flow** they can look at on a
screen before a provider is wired in:

- The overlay offers the tiers (B368). The owner picks one and confirms.
- Confirming creates a **transaction** and takes them to a separate
  `/<user>/payment/<id>` page — and the **same link is emailed**, so they can
  leave and come back to it later.
- That page shows the amount, the **transaction id**, the **status**, and
  payment options (**TWINT**, **credit card**). It has **Pay now**, and if they
  come back later it shows where the transaction stands.
- Pressing **Pay now** (mock, no provider yet) marks the transaction paid,
  shows a success screen, and sends a **"payment successful" email** naming the
  transaction — but **adds no credits**. Real crediting waits for the provider.

This supersedes B368's static dead page (`app/[user]/credits/pay/[tier]`), which
is removed here.

## The invariant, unchanged and load-bearing

**No credits are ever added over HTTP** — not by purchase, not by "Pay now", not
by anything. `grant()` in `lib/credits.ts` stays the only balance-increasing
function and stays reachable only from `scripts/grant-credits.ts`. `test/credits.test.ts`
fails the build if any file under `app/` imports `grant`; that must keep
passing. When a real PSP lands, a *verified provider webhook* (server-to-server,
signature-checked) will be the thing that grants — never the browser "Pay now",
which is why paying grants nothing today. Say this in the pay route's doc
comment so nobody "finishes" it by adding a grant to the button.

## Work

### A transaction table — migration `018-payments` (confirm the number with `ls lib/db/migrations`)

```
payments   id           TEXT PRIMARY KEY NOT NULL   -- random, unguessable; it is the link
           owner_id     TEXT NOT NULL               -- the username; tenant boundary
           credits      INTEGER NOT NULL            -- what the tier buys
           amount_rappen INTEGER NOT NULL           -- price, integer rappen (never a float)
           status       TEXT NOT NULL               -- 'pending' | 'paid'
           method       TEXT                         -- 'twint' | 'card', null until paid
           created_at   TEXT NOT NULL
           paid_at      TEXT                         -- null until paid
```

Schema rules per `lib/db/schema.ts` (text ids in app code, ISO-8601 UTC text
timestamps, integers for counts/money). Add to `TABLE_NAMES` so `lib/deletions.ts`
sweeps a journal's payments when the journal goes. `id` is a `crypto.randomUUID()`
(or a longer random token) — it is the capability in the URL and the email, so it
must be unguessable, and it is stored as-is (it is not a password; it grants only
"view/mark-paid this one mock transaction", which adds no credits).

### `lib/payments.ts`

- `createPayment(owner, tier): Promise<{ id, credits, amountRappen }>` — writes a
  pending row from a `TIERS` entry (`lib/credits/pricing.ts`), never from
  client-supplied amounts.
- `getPayment(owner, id)` — one row, scoped to `owner_id === owner` (so
  `/<userA>/payment/<idB>` for another user's id resolves to nothing).
- `markPaid(owner, id, method)` — pending→paid, sets method+paid_at; idempotent
  (paying an already-paid row is a no-op success, never a second email/among
  other things never a grant). Validates `method ∈ {twint, card}`.
- No function here touches credits. It imports nothing from `lib/credits` except
  the `TIERS`/pricing (which is in `lib/credits/pricing.ts`, not the server-only
  `lib/credits.ts`).

### Routes

- **Extend** `POST /api/v1/<user>/credits/purchase` (B368, owner-only via
  `isOwner`): create a pending payment, mail the owner the `/<user>/payment/<id>`
  link (via `sendTransactional`+`renderMail`, to the config owner address, never
  a body address), and return `{ ok, paymentUrl, transactionId }`. Transactional
  mail → free, never spends.
- **`POST /api/v1/<user>/payments/<id>/pay`** — body `{ method }`. Marks the row
  paid, sends the "payment successful" email (naming the transaction id and what
  it bought), returns success. **Adds no credits.** Rate-limit it. Not
  owner-gated by session: the unguessable id is the capability (same shape as the
  manage/delete links), but the URL's `<user>` must match the row's `owner_id`.
  Refuse an unknown id with the same answer as a mismatched one (no existence
  oracle).

### Pages

- **`/<user>/payment/[id]/page.tsx`** — resolves the payment by (user, id). Shows
  the credits, the amount (`formatChf`), the transaction id, and the status.
  - `pending`: TWINT / credit-card options (radio) and a **Pay now** button that
    POSTs to the pay route, then shows success.
  - `paid`: a paid confirmation with the method and `paid_at`, no Pay button.
  - Unknown/foreign id: a neutral not-found notice (`NoticeShell`), no leak.
  - Reachable with no session (it is the emailed link). Do not render anything
    from other journals.
- Remove `app/[user]/credits/pay/[tier]/page.tsx` (B368's placeholder) and point
  the overlay at the new flow: on confirm, POST purchase, then send the owner to
  `paymentUrl` (and the email carries the same link).

### Overlay change

B368's overlay currently closes to "Payment info sent to your mail". Change the
confirm to: create the transaction and **navigate to `paymentUrl`** (client-side
`window.location` or a returned redirect), while the email still carries the same
link for later. Keep the tier selection and the accessible-dialog basics.

### Copy

All new strings in `content/locales/{en,de,hu}.json`; run `npm run i18n:keys`.
The success wording must not overclaim: "Payment recorded — this is a preview,
no card was charged and no credits were added yet" or similar, because nothing
real happened. Do not say "credits added".

### Not in this ticket

- Any real PSP, TWINT/card SDK, redirect to a real gateway, or webhook. The
  options are labels and the Pay button is a mock.
- Actually crediting the account on payment. That is the provider-webhook ticket,
  and it is the ONLY place a future `grant` call belongs — server-side, on a
  verified webhook, never the browser.
- Refunds, receipts/invoices, currencies other than CHF.

## Acceptance

- `npm run verify` green; `npm run unused` clean.
- `test/payments.test.ts` and route tests:
  - Purchase (owner) creates a pending payment and mails the link; balance +
    ledger unchanged.
  - `GET /<user>/payment/<id>` renders pending with the tier, amount and txid;
    a foreign/unknown id renders the neutral notice and leaks nothing.
  - `POST .../payments/<id>/pay` flips to paid, sends one success `.eml`, and
    **leaves the balance and ledger unchanged** (asserted — the whole point);
    paying twice sends no second email and still adds nothing.
  - No file under `app/` imports `grant` (the existing test still passes).
  - A method other than twint/card is refused.
- By hand with `MAIL_TRANSPORT=file`: buy → land on the payment page → see txid +
  status pending → Pay now → success screen + a success `.eml` → revisit the
  same link → shows paid. Credits unchanged throughout.
