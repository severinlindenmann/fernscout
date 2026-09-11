---
id: B1165
title: A printer refusal says nothing about why, to anybody who could act on it
type: ISSUE
priority: medium
complexity: low
area: photobook, print
found: "2026-09-09T22:08:00Z"
started: "2026-09-11T04:23:07Z"
merged: "2026-09-11T05:13:55Z"
---

# B1165 — A printer refusal says nothing about why, to anybody who could act on it

## Why

`markPrintFailed(owner, id, payload, "refused")` stores a code. Gelato's own
answer is thrown away everywhere except `console.error`, so the only account of
why a book was not printed lives in `journalctl`.

The live case that found it: two paid orders on fernscout.ch came back
`refused`, and the page said nothing beyond that. The actual reason was

```
{"code":"BAD_REQUEST",
 "message":"To be able to place an order please complete the company
            information in the portal."}
```

— an operator task, in Gelato's portal, that no amount of retrying would fix
and nothing on the site would ever have said. The owner asked why; the answer
required ssh.

The money is safe (the refund path is sound and was verified on these two
orders), so this is about a dead end nobody can get out of, not a loss.

## Work

- Store the provider's message on the order beside the failure code.
- **Do not show it to any journal owner.** On a hosted instance the message is
  about the *operator's* account — "complete the company information in the
  portal" is not a sentence a guest journal's owner can act on or should read.
  The owner gets a plain "the printer refused this and you have been refunded".
- Show it to the instance operator: `/admin` is the page that is about the
  instance rather than a journal, and `FERNSCOUT_ADMIN_EMAIL` is who reads it.
- Consider mailing the operator on a refusal — a refused order is the only
  failure here that no owner can resolve.

## Acceptance

- A refused order carries the provider's own message in the database.
- `/admin` shows it; the owner's order page does not.
- `npm run verify`.

## Build notes (2026-09-11)

Built per the run brief's chosen option (payload storage, no migration),
landing last in group-c against B1148 and B1223's already-changed code:

- `gelato.ts`'s `post()` now returns `{ error, message? }` instead of
  collapsing Gelato's own `{code, message, details}` to the bare string
  `"refused"`. `submitBookPrint`'s declared return type widened to carry it;
  `quoteBook` was left alone (its declared type still hides `message`) since
  B1165's own repro — and every failing site in `troubles()` — is a refused
  *order*, never a refused *quote*.
- `PhotobookPayload.print.providerMessage?: string` sits beside `failure`.
  `markPrintFailed` takes it as an optional 5th argument, written from both
  `submitBookPrint` failure sites in `print.ts` (already touched by B1148 for
  the failure-kind fork).
- **Widened `troubles()`**, which was the scope explicitly approved beyond
  the ticket's own line numbers: `markPrintFailed` leaves `status: 'printed'`
  so the row stays retryable (B1348), so the original `WHERE status =
  'failed'` never saw a photobook refusal at all — the ticket's stored
  message would otherwise be invisible. Added a second pass over recent
  `kind = 'photobook', status = 'printed'` rows, parsed in application code
  (the payload column is JSON-as-text; there is no existing pattern in this
  codebase for querying into it at the SQL level across both dialects), that
  surfaces one Trouble per row whose `payload.print.failure` is set.
- The provider's message appears only in that `Trouble.detail`, which only
  `/admin` reads. No route under `app/` — the owner's order page, the agent
  API, or anywhere else — was given `providerMessage`; grepped for the field
  to confirm.
- No mail to the operator, per the ticket's own "not doing" line.

New tests in `test/photobook-print-orders.test.ts`: the message survives into
`payload.print.providerMessage`; a refused-but-`printed` row reaches
`troubles()` with the provider's words in `detail`; a normal `printed` order
(no failure) is not mistaken for one.
