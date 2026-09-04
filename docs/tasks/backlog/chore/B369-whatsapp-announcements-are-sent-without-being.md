---
id: B369
title: WhatsApp announcements are sent without being charged, because B365 landed after the ledger
type: CHORE
priority: medium
complexity: low
area: credits, whatsapp
found: "2026-09-04T21:03:24Z"
---

# B369 — WhatsApp announcements are sent without being charged, because B365 landed after the ledger

## Why

B366 charges one credit per email and refuses a send at zero. It deliberately
does **not** touch WhatsApp, because B365 is uncommitted work in
`.claude/worktrees/b365-whatsapp` — `lib/digest/dayWhatsapp.ts`,
`lib/api/publishFlags.ts` and the publish route are all open there, and editing
another session's worktree is the thing AGENTS.md forbids by name.

So between the two merges there is a hole: a Meta template message is billed per
conversation, `sendDayWhatsapp` sends one per opted-in contact, and nothing
counts them. A journal at zero credits still cannot mail, and can still WhatsApp
four hundred people.

**Do not start this until B365 has merged to `main`.** Check with `git log
--oneline main | grep B365` from the shared checkout.

## Work

The seam is already the same shape; this is three edits.

1. In `sendDayWhatsapp` (`lib/digest/dayWhatsapp.ts`), after `recipientsFor`
   resolves and before the send loop: `spend(owner, recipients.length,
   "day_whatsapp", ref + "/" + slug)`, and on `false` return `{ ok: false,
   reason: "no_credits" }`. Refund `failed.length` after the loop. All or
   nothing, exactly as mail — the same decision, for the same reason.
2. Add `"no_credits"` to `DayWhatsappSkipReason`, and to `capabilityMessage` in
   `.../send-whatsapp/route.ts`. Return `402` for it there, `400` for the rest,
   matching what B366 did to `send-mail`.
3. The publish pre-flight (`.../publish/route.ts`) currently costs only mail.
   Extend it: when `send_whatsapp` is true, add the WhatsApp recipient count to
   `needed` before comparing against the balance. **Both channels are checked
   against one balance in one comparison** — checking them separately lets a
   journal with 10 credits pass a 6-credit mail check and a 6-credit WhatsApp
   check and then be refused halfway through, publishing the day and sending
   only one of the two.

Export a `wouldCost` from `dayWhatsapp.ts` mirroring the one B366 added to
`dayLetter.ts`, reusing `recipientsFor` rather than counting again.

Then switch B367's WhatsApp row on: it renders `0` behind
`isEnabled("whatsapp", user)` until this ships.

### Not in this ticket

- Charging WhatsApp differently from email. One credit each, flat, per B366's
  decision — Meta's real per-conversation price differs from an email's real
  price, and pricing them apart is a business decision nobody has made.
- The 24-hour service window, conversation-based billing, or any attempt to
  model Meta's actual invoice.

## Acceptance

- `npm run verify` green.
- `test/whatsapp.test.ts` gains the mirror of B366's mail cases: 3 opted-in
  numbers and 2 credits → `{ ok: false, reason: "no_credits" }` with **zero**
  messages handed to the provider; 3 credits → 3 sent, balance 0.
- A publish with both `send_mail: true` and `send_whatsapp: true`, 12 mail
  recipients, 12 WhatsApp recipients and 20 credits, answers `402` and
  publishes nothing — the combined check, which is the case a per-channel check
  gets wrong.
- With `credits` disabled, WhatsApp sends exactly as it does today.
