---
id: B366
title: Sending a letter or a message costs a credit, and a journal starts with none
type: FEATURE
priority: high
complexity: high
area: credits, mail, api
found: "2026-09-04T21:02:47Z"
---

# B366 — Sending a letter or a message costs a credit, and a journal starts with none

## Why

Every letter this instance sends is billed to one credit card, and nothing in
the codebase knows that. `sendDayLetter` (`lib/digest/dayLetter.ts:361`) walks
its recipient list and sends, unmetered and unbounded; `sendDayWhatsapp` in the
B365 worktree does the same, and a WhatsApp template message is billed by Meta
per conversation. A journal with four hundred approved contacts publishing
fifteen days is eight thousand sends nobody authorised and nobody counted.

The owner's decision is a **prepaid credit balance per journal**: one credit per
email delivered, one per WhatsApp message delivered, and **no journal starts
with any**. Credits enter only by direct database entry by the operator — there
is no purchase path in this task and none in B368 either, which mails a dead
link on purpose.

This ticket is the ledger, the debit and the refusal. B367 shows the balance,
B368 mocks buying, B369 charges WhatsApp once B365 has merged.

### The two properties that actually matter

Everything else here is bookkeeping. These two are the reason the ticket is
`priority: high`:

1. **Nothing reachable over HTTP may increase a balance.** Not an API route,
   not a server action, not a form. A `grantCredits` that any request can reach
   is a credit card any request can spend. B368's "Buy" button therefore mails
   information and grants nothing.
2. **A balance may never go below zero, under concurrency.** Two publish calls
   arriving together must not each read `10`, each decide `10 >= 8`, and send
   sixteen. The guard is a single conditional `UPDATE … SET balance = balance -
   :n WHERE owner_id = :u AND balance >= :n`, and it is the *rows affected*
   that decides — never a `SELECT` followed by an `UPDATE`. That statement is
   atomic on both SQLite and Postgres, which is why it is the primitive rather
   than `SELECT … FOR UPDATE` (SQLite has none) or a `SUM()` over the ledger.

## Work

### The capability — off by default, and a toggle in `content/config.json`

Add `credits` to `FEATURE_NAMES` (`lib/config.ts:8`) and to `DEFAULT_FEATURES`
(`lib/config.ts:195`) as `{ enabled: false }`. Add the same block, disabled, to
`content/config.json` so the operator switch is visible where the other five
already are.

**Off means today's behaviour, exactly**: no debit, no refusal, no panel, no
new response fields — per the AGENTS.md rule that a disabled capability is
*absent* rather than broken. Without this a fresh clone of this repository has
zero credits and cannot send a single letter, which is a broken checkout, not a
business model. `/api/health` explains why it is off, as for every other
capability.

### The two tables — migration `016-credits`

B365's worktree already holds `015-contact-whatsapp`, uncommitted. Take `016`
and confirm with `ls lib/db/migrations` in **both** checkouts before writing
the file; a renumber after either has run anywhere is not recoverable
(`lib/db/migrations/index.ts` — the name is the primary key in
`kysely_migration`).

```
credits            owner_id TEXT PRIMARY KEY   -- the username; see lib/db/owner.ts
                   balance  INTEGER NOT NULL DEFAULT 0
                   updated_at TEXT NOT NULL

credit_ledger      id TEXT PRIMARY KEY
                   owner_id TEXT NOT NULL
                   delta INTEGER NOT NULL      -- +grant, -spend, +refund
                   reason TEXT NOT NULL        -- 'grant' | 'day_mail' | 'day_whatsapp' | 'refund'
                   ref TEXT                    -- '<trip-ref>/<slug>', null for a grant
                   note TEXT
                   created_at TEXT NOT NULL
```

Both tables per the schema rules in `lib/db/schema.ts`: text ids generated in
app code, ISO-8601 UTC text timestamps, integers for counts. Add both to
`TABLE_NAMES` (`lib/db/schema.ts:413`) — `lib/deletions.ts` walks that list, so
a journal's credit rows go when the journal does.

**Why two tables and not one.** The ledger alone would make the balance a
`SUM()`, and there is no portable way to insert a row conditional on a `SUM()`
across both dialects — which is property 2 above, lost. The `credits` row is
the atomic guard; the ledger is the audit trail that says where every credit
came from and went. `credits.balance` is authoritative; a `npm run credits --
audit` that compares it against `SUM(delta)` is a cheap way to notice drift and
belongs in this ticket.

### `lib/credits.ts` — the whole surface, and it is small

```
balanceOf(owner): Promise<number>            -- 0 when there is no row
spend(owner, n, reason, ref): Promise<boolean>   -- the conditional UPDATE; false = insufficient
refund(owner, n, reason, ref): Promise<void>     -- unconditional; only ever for a send that did not happen
grant(owner, n, note): Promise<void>             -- NOT exported to anything HTTP-reachable
```

`spend` and `refund` write their ledger row in the same transaction as the
balance change. `grant` is used by the script below and by nothing else; keep it
in this module rather than inventing a second one, but the *test that no route
imports it* is part of the acceptance.

Guard the module on `isEnabled("credits", owner)`: with the capability off,
`spend` returns `true` without touching the database and `balanceOf` answers
`null`, so callers need no branch of their own.

### `scripts/grant-credits.ts` — the only way in

`npm run credits -- grant <username> <n> ["note"]`, plus `list <username>` and
`audit`. A CLI over the same `lib/credits.ts`, run by the operator with a shell
on the box. It is deliberately not an API route and must never become one; say
so in the file's own doc comment.

### Charging the send — one choke point

Inside `sendDayLetter` (`lib/digest/dayLetter.ts:361`), after `recipientsFor`
resolves (`:384`) and before the send loop (`:390`):

- `const needed = recipients.length`
- `if (needed > 0 && !(await spend(owner, needed, "day_mail", ref+"/"+slug)))`
  → `return { ok: false, reason: "no_credits" }`
- run the loop
- `if (failed.length > 0) await refund(owner, failed.length, "refund", …)`

**All or nothing**, per the owner's decision: twenty-five recipients against ten
credits refuses the whole send. Nobody gets a half-delivered announcement, and
the owner never has to work out which fifteen people did not hear from them.

The refund is for sends that **did not happen** — the `failed` array, which is
already a per-recipient `try` — and never a blanket reversal. A delivered letter
is spent whatever happens afterwards.

Add `"no_credits"` to `DayLetterSkipReason`. `mailSummary`
(`lib/api/dayMail.ts`) then reports it with no change, but extend it to carry
`needed` and `balance` on that one reason so a client can say something useful.

Putting the debit *here* rather than in the two routes is the root-cause
placement: every caller of `sendDayLetter`, present and future, is charged, and
a third trigger added later cannot forget.

### Refusing the publish — the owner's decision, and the one thing that is awkward

The owner chose: `POST .../publish` with `send_mail: true` and an insufficient
balance is **`402 Payment Required` and nothing is published**. The day stays a
draft.

That means a **pre-flight check before `publishDraft`**
(`app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route.ts:104`), not the
debit above — the debit needs a published day to render a letter from, and the
refusal needs to happen before anything changes on disk. So:

1. read the flags (`:102`)
2. if `send_mail` (and, after B369, `send_whatsapp`): count what the send would
   cost and compare against the balance; on `needed > balance` return `402`
   with `{ error: "no_credits", needed, balance }` and publish nothing
3. `publishDraft`
4. the existing best-effort send, which does the real atomic debit

Export a `wouldCost(owner, ref, slug)` from `lib/digest/dayLetter.ts` that
reuses `recipientsFor` so the count and the charge cannot disagree — a second
recipient-counting function is exactly the drift `mayMailTrip`'s doc comment
already warns about.

**Step 2 is a check and step 4 is the guard.** Between them another call can
spend the balance, in which case the day is published and the letter comes back
`no_credits` — the outcome the owner declined for the ordinary case, reached
only in a race. That is the correct trade: the alternative is holding credits
reserved across a filesystem write, and a crash there loses them silently.
Write this window into the route's doc comment rather than leaving the next
reader to find it.

`POST .../send-mail` needs no pre-flight — nothing is being published, so
`sendDayLetter`'s own refusal is the whole answer. Return `402` rather than
`400` for `no_credits` there; the other reasons keep `400`.

### Not in this ticket

- **WhatsApp.** B365 is uncommitted in `.claude/worktrees/b365-whatsapp` and
  touches `dayWhatsapp.ts`, `publishFlags.ts` and the publish route. Charging it
  is B369, after that merges. Design the seam for it — `spend(owner, n,
  "day_whatsapp", …)` is the same three lines — but do not edit that worktree.
- **Buying credits.** B368.
- **The panel.** B367.
- **Charging anything but reader-facing bulk.** Login codes, deletion
  confirmations, approval mails, postcards and B368's own purchase mail are
  transactional and free. Only `sendDayLetter` and (later) `sendDayWhatsapp`
  charge. State this in `lib/credits.ts`'s doc comment, because the next person
  adding a mail path will ask.
- Per-recipient pricing, currencies, expiry, refunds to a card, invoices.

## Acceptance

- `npm run verify` green.
- `test/credits.test.ts`:
  - A journal with no row has balance 0 and `spend(u, 1, …)` returns `false`.
  - `spend` of exactly the balance succeeds and leaves 0; one more fails and
    leaves the balance untouched.
  - **Concurrency:** balance 10, ten concurrent `spend(u, 2, …)` — exactly five
    succeed, five fail, final balance 0. Run it against SQLite; it is the test
    that pins property 2.
  - Every `spend`, `refund` and `grant` writes exactly one ledger row, and
    `SUM(delta) === balance` after an arbitrary sequence.
  - With `credits` disabled, `spend` returns `true` and writes no row.
- `test/day-mail.test.ts` gains: 3 opted-in recipients and 2 credits → outcome
  `{ ok: false, reason: "no_credits" }` and **zero** mails written under
  `content/<user>/mail/`; 3 credits → 3 mails and balance 0.
- A grep-style test asserting no file under `app/` imports `grant` from
  `lib/credits` — property 1, mechanised rather than trusted.
- By hand, `credits` on and balance 0: `POST .../publish {"send_mail": true}`
  answers `402`, and `GET` the day back still shows `status: draft`. With
  `credits` off the same call publishes and sends as it does today.
