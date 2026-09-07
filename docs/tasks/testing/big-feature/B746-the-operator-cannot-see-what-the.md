---
id: B746
title: The operator cannot see what the instance costs to run
type: FEATURE
priority: high
complexity: high
area: ops, credits, helper
found: "2026-09-07T13:05:00Z"
merged: "2026-09-07T13:14:23Z"
---

# B746 — The operator cannot see what the instance costs to run

## Why

Money leaves this instance through six doors and there is no page that adds
them up. `FERNSCOUT_ADMIN_EMAIL` opens every journal (B480) but opens no view
of the instance as a whole, so the only honest answer to "what did last month
cost" is a card statement and some arithmetic.

Worse, one of the six records nothing at all. The model calls in
`lib/helper/model.ts` throw `response.usage` away, so the tokens that were
actually spent are unrecoverable after the request. Every other door already
keeps what it needs:

| Door | What exists today |
| --- | --- |
| Anthropic — `writeDay`, `describePhotos`, `routeAsk` | **nothing** |
| Deepgram — `transcribeAudio` | returns `seconds`, then drops it |
| Postcards, photobooks | `print_orders.cost_minor` + `provider` — real money, already stored |
| WhatsApp | `day_notifications` rows, and `day_whatsapp` in `credit_ledger` |
| Mail, push | `day_notifications` / free |
| Hetzner, domain | fixed, written nowhere |

Per-journal credits are likewise already whole: `credits.balance` and the
append-only `credit_ledger`. Nothing reads them back but
`npm run credits -- list`, which needs a shell on the box.

## Work

**1. Meter the two metered providers.** One new `usage` table — provider,
model, owner_id, three unit columns, created_at — and one `recordUsage()`
helper. Wire it into the three Anthropic call sites (from `response.usage`,
which already comes back) and into `transcribeAudio` (from `seconds`, which it
already returns). Append-only, same shape as `credit_ledger`.

Record it **after** the call succeeds, and never let a failure to record fail
the request: this table is an operator's accounting, and a person's write-up
must not be lost because a metering insert did.

**2. A price list in `site/config.json`.** Per-million-token in and out per
model, per-minute for Deepgram, and the two fixed lines — Hetzner and the
domain. Config, not code: prices change without a deploy, and they are the
operator's numbers. Not secrets.

**3. `/admin`, owner of the instance only.** Cookie session plus
`isAdminEmail`, never a bearer token — AGENTS.md is explicit that an agent
token reaches `/api/` and never a rendered page, and this page shows every
journal's balance. Unset `FERNSCOUT_ADMIN_EMAIL` means the page 404s, the same
way the rest of `lib/admin.ts` behaves when it is absent.

It shows, for a chosen period:

- each provider: calls, units, computed cost
- postcards and photobooks: orders and the `cost_minor` actually charged
- WhatsApp, mail, push, notifications: counts, and free stated as free
- the fixed lines, and a total
- per journal: credits granted, credits spent, balance now, and its ledger

**4. Granting credits, without weakening the invariant.** Decided with the
owner on 2026-09-07: `lib/credits.ts`'s property 1 stands — no request raises a
balance. The `/admin` grant button writes a pending grant and mails the
operator a single-use link, and the link grants. That is the shape
`app/api/v1/[user]/payments/[id]/approve/route.ts` already has and the shape
`DELETE /api/v1/<user>` already has, so `GRANT_ALLOWED` in
`test/credits.test.ts` does not widen and no comment in `lib/credits.ts` is
rewritten.

Editing a balance downward is **not** in scope: the ledger is append-only and a
correction is a negative grant, which is a second decision and a separate
ticket if it is wanted.

**Not doing:** live provider balances. "How much credit is left at Anthropic"
needs an `sk-ant-admin` key and Deepgram's project API, which is two more
secrets and two integrations that go stale silently. Deferred with the owner on
2026-09-07; capture it separately if the metered spend turns out not to answer
the question.

## Acceptance

- A write-up through `/agent` leaves a row in `usage` carrying real input and
  output token counts, and a transcription leaves one carrying real seconds.
- `/admin` renders for `FERNSCOUT_ADMIN_EMAIL` on a cookie session, 404s for
  everybody else, and 404s when the variable is unset.
- The page's total for a period is arithmetic over rows a test can construct.
- Nothing under `app/` imports `grant` but the two approve routes;
  `test/credits.test.ts` passes unchanged.
- A model call that succeeds and a metering insert that fails still returns the
  person their day.
