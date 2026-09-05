---
id: B338
title: A mailed invitation knows the address it was sent to and asks the reader to type it again
type: ISSUE
priority: medium
complexity: low
area: contacts, invites
found: "2026-09-04T19:24:36Z"
started: "2026-09-04T19:25:01Z"
merged: "2026-09-04T19:36:46Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T07:38:40Z"
---

# B338 — A mailed invitation knows the address it was sent to and asks the reader to type it again

## Why

Reported by the owner on 2026-09-04, after the first real mailed invitation
(B319, documented by B333). The landing page prefills **Name** — "Test Guest",
from the invite — and the **language**, and then asks for the email address it
already knows, having just mailed the link to it.

Retyping is the small half. The sharp half is what happens when the reader
types something *else*: pre-approval matches on that exact address
(`preapprovedEmailFor(...) === contact.email`, `app/api/contacts/confirm/route.ts:69`),
so a different address — a work one, a typo, a preferred alias — silently
falls to the ordinary path. They land in the owner's queue, nothing says why,
and the owner is told this person would be admitted without a second decision.
Prefilling removes the commonest way to lose the thing the owner just paid a
mail to arrange.

The page cannot do it today: `resolveInvite` returns an `Invite`
(`lib/contacts/invites.ts:71-82`) with `name` and `locale` and **no address**.
The row has one — `email_key`, added by B319's migration — and that migration's
own comment says it is *"a lookup key, not the address to show anybody"*, which
is exactly the caution this ticket has to answer rather than ignore.

## Two things to decide before writing code

**1. Showing it discloses it.** A guest link is described in both documents as
*safe to forward*. Prefilled, a forwarded link shows the invited person's
address to whoever now holds it. The mitigating argument is real — the link was
mailed *to* that address, so anybody holding it legitimately already read it in
their own inbox — but a link pasted into a group chat is a different thing, and
"safe to forward" is a promise this project made in writing.

Worth weighing: prefill only when the invite carries an address (a mailed one),
which is the only case where the person opening it is expected to be that
person; and consider whether the field should be prefilled but *visible and
editable*, which it must be anyway, so nothing is hidden from the reader.

**2. `email_key` is normalised, not the address as typed.** It is case-folded
for comparison. Prefilling it shows a lowercased form, which for almost every
address is identical and for a few is not what the owner typed. Either store
the address as given alongside the key, or accept the normalised form and say
so in a comment — do not quietly present a lookup key as somebody's address.

## Work

- Carry the invited address through `resolveInvite` into the landing page, and
  prefill the email field with it.
- **Say what the field means when it is prefilled**: this invitation was sent
  to this address, and using a different one means waiting for the owner
  instead. One line, in all three locales. That sentence is the actual fix —
  the prefill is the convenience, the explanation is what prevents the silent
  fall-through.
- Keep the field editable. Somebody who genuinely wants a different address
  must be able to say so, and take the ordinary path knowingly.
- Whichever way decision 1 goes, write the reasoning into the code near the
  prefill, because "safe to forward" appears in two generated documents and the
  next person will ask.

## Acceptance

- Opening a mailed invitation shows the address it was sent to, already filled
  in.
- Changing it is possible and the consequence is stated before submitting.
- A link with no address attached — one the owner copied by hand — prefills
  nothing and is unchanged.
