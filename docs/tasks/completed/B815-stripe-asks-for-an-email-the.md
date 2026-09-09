---
id: B815
title: Stripe asks for an email the owner has already given this server
type: FEATURE
priority: low
complexity: low
area: credits, payments
found: "2026-09-07T15:35:00Z"
merged: "2026-09-07T15:35:07Z"
completed: "2026-09-09T16:45:42Z"
---

# B815 — Stripe asks for an email the owner has already given this server

## Why

The hosted checkout page opens with an empty "Contact information" box, and the
person filling it in is the owner of a journal whose `config.json` names their
address. It is a field typed on a phone for no reason, and typing it wrong
sends the receipt nowhere.

## Work

`customer_email` on the Checkout Session, from `journal.owner.email` — the same
address `/credits/purchase` already mails the link to. One argument.

**The tradeoff to write down rather than discover.** The payment page is
authenticated by the payment id and nothing else, so anybody holding the link
reaches the Stripe page — and prefilling puts the owner's address on it. That
link is mailed to the owner and may be handed on by an agent, so it is a small
disclosure to whoever the owner chose to give it to, not to the world. Worth it
against a field the owner would otherwise type on a phone; and the address is
where the receipt has to go regardless, since the credits are theirs.

Not doing: letting a caller name the address. That would make this a way to
send Stripe mail to somebody who never asked, which is the same reason
`/credits/purchase` mails `journal.owner.email` and never a body value.

## Acceptance

- Opening a payment page on an instance with Stripe shows the owner's address
  already filled in on Stripe's page.
- A journal whose `config.json` has no owner address still reaches a working
  checkout, with the field empty.
