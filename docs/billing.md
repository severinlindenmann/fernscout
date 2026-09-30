# Billing: plans, entitlements and what each state means

Decided by the owner on 2026-09-30 (TIX-5), and built as the billing run
B2589–B2599. This is the one place the plans and the rules they run on are
written out in full; every ticket in that run, and every piece of code that
reads a plan, refers back to this file rather than repeating it.

## Plans

- **Free, CHF 0.** Unlimited trips, days and readers. AI (photo
  descriptions, dictation, polish) for 10 travel days, once per owner for
  life — a new trip does not reset it. Email postcards (the day letter,
  `lib/digest/dayLetter.ts`) unlimited, as today. Push to readers who
  installed the app. 2 GB of storage. The owner's phone is checked once at
  signup by SMS (up to 3 tries), then sign-in is email only. Printed
  postcards and photobooks at full price.
- **Trip pass, CHF 19 once (CHF 22 in the iPhone app), 45 days from
  purchase.** AI for 21 travel days within those 45. Unlimited email
  postcards. One printed postcard included, then CHF 3.50 each. 10 GB, no
  add-on. Upgrade to Plus on the web within 60 days with a single-use
  CHF 19 Stripe coupon.
- **Plus, CHF 49 a year (CHF 59 in the app).** AI for 100 travel days per
  subscription year, stated openly — never "unlimited". 3 printed postcards
  per plan year included, then CHF 2.90 each. CHF 10 off every photobook,
  including copies readers order. 10 GB, +10 GB for CHF 10 a year. Renews
  yearly, with a reminder 30 days before.
- **Prices.** Printed postcard: CHF 3.90 (Free), CHF 3.50 (pass), CHF 2.90
  (Plus). Photobook, 46 pages: CHF 47.90, CHF 10 off on Plus. Every print is
  paid at checkout (Stripe: TWINT or card) — there is no credit balance.
- **No WhatsApp in any plan.** No WhatsApp day notifications, no WhatsApp
  postcard. Meta's number stays for Fernscout's own opted-in marketing. No
  SMS codes for readers; readers sign in by email.

`PLANS` in `paid/credits/lib/plans.ts` is the one place these numbers live in
code — the homepage, `/prices` and every limit below read from it, so a
change here and a change there cannot disagree.

## Rules

- **The highest active plan wins:** Plus, then pass, then Free. A cancelled
  Plus runs until its paid period ends — cancelling stops the *next* charge,
  not the plan already paid for.
- **One payment, one plan.** A provider reference (a Stripe checkout,
  invoice or subscription id, or an Apple transaction id) is unique on the
  `entitlements` table, so one payment can never grant two plans. State
  changes are single conditional updates — the `claimProviderPayment`
  pattern in `paid/credits/lib/payments.ts` — so an older event can never
  overwrite a newer state, and there is no separate events table to reconcile
  against this one.
- **Fail closed, but only when billing is actually metering.** With the
  `billing` capability on, an error reading an owner's plan reads as Free —
  never as "let it through". With `billing` off, or with `paid/` absent
  entirely, `planOf()` reports every owner unlimited and nothing is
  metered — the same "absent, not broken" posture every optional capability
  takes.
- **An AI day is used once, by whichever tool uses it first.** The first
  draft, polish or photo description (write-day, describe-photos) on a trip
  date spends that date's AI day; further AI work on the same date spends
  nothing more. A failed model call spends no day. Tools with no day of
  their own — dictation, ask, people from a photo, statement — need an
  active plan or unused Free days to run at all, but take no day themselves;
  their existing rate limits still apply on top.
- **Grace period.** A failed Plus renewal gets 7 days of grace before the
  plan actually ends. When a plan ends — grace exhausted, a pass's 45 days
  run out, an admin grant expires — AI stops, nothing already written is
  deleted, content stays readable and printable, and no new upload above
  2 GB is accepted.
- **Deleting a journal cancels its Stripe subscription at the request**, the
  moment the deletion is requested, not when the delayed deletion actually
  completes days later.
- **No legacy.** There are no customers yet, only test journals on
  dev.fernscout.ch and fernscout.ch. Nothing is migrated or converted from
  the old credit system; credits are deleted, not translated into a plan.

## What a state means

| State | Who can see it | What it means |
| --- | --- | --- |
| No `entitlements` row | Anyone | Free — the absence of a row *is* Free, exactly like a journal nobody has granted credits to has a balance of zero rather than a row saying so. |
| `status: active` | The owner, the operator | The plan is in force; its limits apply. |
| `status: grace` | The owner, the operator | A Plus renewal failed; the plan's limits still apply for the 7-day grace window above. |
| `status: ended` | The operator (history) | The plan ran out — `ends_at` passed, or an admin ended it early. The row stays as a record; nothing is deleted. |
| `status: refunded` | The operator (history) | The purchase was refunded. Terminal, like `ended`: nothing re-grants from it. |
| `billing` capability off, or `paid/` absent | Everyone | `planOf()` reports every owner unlimited. Nothing is metered, nothing refuses. |

## Who may write a plan

Only three places ever insert or update an `entitlements` row, all through
`grantPlan`/`endEntitlement` in `paid/credits/lib/entitlements.ts`:

1. **The admin plan-grant route** (`/api/web/admin/plan-grants`, behind the
   operator's own session) — for testers and the App Store reviewer.
2. **The Stripe webhook**, once it claims a signed, verified payment — not
   built in this run; B2593/B2598 add it, behind the same
   `claimProviderPayment` single-conditional-write pattern `payments.ts`
   already uses.
3. **The Apple endpoint**, the same shape, once B2598 adds in-app purchase.

`paid/test/credits.test.ts`'s plan-grant allowlist enforces this
mechanically, the same way it already enforces "only sanctioned code grants
credits".

## Storage

Storage quota follows the plan directly: Free 2 GB, pass and Plus 10 GB, plus
whatever extra GB a Plus owner has bought. `lib/storageQuota.ts` reads
`planOf()` and existing content over quota is never touched — only a new
upload past the ceiling is refused.
