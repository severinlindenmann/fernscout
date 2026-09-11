---
id: B1165
title: A printer refusal says nothing about why, to anybody who could act on it
type: ISSUE
priority: medium
complexity: low
area: photobook, print
found: "2026-09-09T22:08:00Z"
started: "2026-09-11T04:23:07Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T04:23:07Z"
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
