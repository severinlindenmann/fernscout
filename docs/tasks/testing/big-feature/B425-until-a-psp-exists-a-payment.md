---
id: B425
title: Until a PSP exists, a payment is a request the instance admin approves by an emailed link, which grants the credits
type: FEATURE
priority: medium
complexity: high
area: credits, payments, security
found: "2026-09-05T11:00:00Z"
started: "2026-09-05T09:16:01Z"
merged: "2026-09-05T09:27:43Z"
---

# B425 — Until a PSP exists, a payment is a request the instance admin approves by an emailed link, which grants the credits

## Why

B405 built a mock payment page whose Pay button records a transaction and adds
nothing. The owner wants a working manual bridge until a real provider is wired
in: pressing Pay is a **request**, the **instance admin** gets an email with an
authenticated link, and the admin **accepting** the request is what actually
**grants the credits**. The buyer sees "the admin received your request and
will accept it — there is no payment provider yet."

This deliberately opens the one door B366 kept shut: an HTTP path that grants
credits. It is acceptable only because the accept link goes **to the instance
operator and nobody else**, is single-use, and is unguessable — the operator
approving by email instead of by the CLI. It must be built so that no journal
can approve its own purchase.

## The rule that makes this safe

**The approve link goes only to `site.operatorEmail` — never to the buying
journal's owner.** If a journal owner could approve their own request, buying
would be free and the whole billing system is void. The operator is the one
human who runs the server and reconciles real money (today: agent@fernscout.ch
for this instance). For the `example` journal the owner happens to be the
operator too; for every other journal they differ, and only the operator may
approve.

## Work

### Config

Add `site.operatorEmail?: string` to the server config (`lib/config.ts`), parsed
like `site.credit`. It is the instance admin who approves purchases. Not a
secret (an address), so it lives in `content/config.json`. When absent, the
approval email cannot be sent — the request is still recorded, and the operator
can grant by CLI; do not invent a fallback recipient.

### Migration 019-payment-approval

Add to `payments`: `approve_token_hash TEXT` (sha-256 of the single-use accept
token, null except while awaiting approval), `granted INTEGER NOT NULL DEFAULT
0` (the idempotency guard — credits are granted at most once), `requested_at
TEXT`. Status now also takes `"requested"` (plain text, no schema change).

### `lib/payments.ts`

- Status becomes `"pending" | "requested" | "paid"`.
- `submitRequest(owner, id, method)`: `pending → requested`, records method and
  `requested_at`, generates a random token, stores **its hash**, returns the raw
  token (for the email link, shown once).
- `claimApproval(owner, id, token)`: the atomic guard. One conditional `UPDATE …
  SET status='paid', granted=1, paid_at=…, approve_token_hash=null WHERE id=?
  AND owner_id=? AND status='requested' AND granted=0 AND approve_token_hash=
  sha256(token)`. Returns whether it claimed (rows affected === 1) and the
  payment's credits. It does **not** grant — that stays in the route, so the
  "only the approve route imports grant" invariant holds and stays checkable.
- Keep everything here free of any `lib/credits` import.

### Routes

- **`POST /api/v1/<user>/payments/<id>/pay`** (rework): `submitRequest`, then
  email `site.operatorEmail` (never a body address, never the journal owner) an
  approval mail with a link to `/<user>/payment/<id>/approve/<token>`. The mail
  names the journal, the credits and the price. Response tells the buyer the
  request is in. If `operatorEmail` is unset, skip the mail and say an admin will
  follow up.
- **`POST /api/v1/<user>/payments/<id>/approve`** — body `{ token }`. This is
  **the one sanctioned HTTP grant path.** `claimApproval`; if it claimed, call
  `grant(user, credits, "purchase <id>")` and email the buyer (the journal's
  owner address) that the credits were added. Rate-limit it. No session — the
  token is the capability, and it was mailed only to the operator. Between the
  claim and the grant is a crash window; it fails **closed** (paid+granted but
  no credits), recoverable by the CLI — document it, the same shape as the
  publish pre-flight race. Never double-grants, because the claim is atomic.

### Pages

- **`/<user>/payment/[id]/approve/[token]/page.tsx`** — the operator's confirm
  page. Shows "Approve N credits (CHF X) for <journal> (<user>)?" and an Accept
  button (a small client component posting the token to the approve route). On
  success: "Approved — N credits added to <user>." An invalid/spent token or an
  already-approved request → a neutral notice, no leak.
- **`/<user>/payment/[id]`** (rework the checkout copy): the Pay success state is
  now "requested" — "The admin of Fernscout (<operatorEmail>) received your
  payment request and will accept it. There is no payment provider yet, so it is
  approved by hand." A `paid` payment revisited shows "N credits were added."

### The invariant test

`test/credits.test.ts` asserts no file under `app/` imports `grant`. Change it to
an allowlist of exactly one: `app/api/v1/[user]/payments/[id]/approve/route.ts`.
Anything else importing `grant` still fails the build. Document why that one is
allowed (operator-only, single-use, token-gated).

### Not in this ticket

- A real PSP. When it lands, its verified webhook becomes a second sanctioned
  grant path and the manual approve stays as a fallback.
- Any UI for the operator to browse pending requests (the email link is the UI).
- Refunds/receipts/invoices.

## Acceptance

- `npm run verify` green; `npm run unused` clean.
- Tests:
  - `pay` moves a payment to `requested`, mails `operatorEmail` (not the owner),
    and adds no credits yet.
  - `approve` with the correct token grants exactly `credits` (balance rises by
    that, one ledger `grant` row), marks paid, mails the buyer; a second approve
    is refused and does not grant again.
  - `approve` with a wrong/absent token grants nothing and does not change the
    balance.
  - The approve route is the ONLY file under `app/` importing `grant`.
  - With `operatorEmail` unset, `pay` records the request and mails nobody.
- By hand (MAIL_TRANSPORT=file): buy → pay → see "admin received your request",
  read the operator `.eml`, open its approve link, Accept → the journal's balance
  rises by the tier's credits and the buyer gets a confirmation; re-open the
  approve link → it is spent.
