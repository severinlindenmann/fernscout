---
id: B272
title: A transient mail failure tells a reader their code was wrong and loses the owner's notification for good
type: ISSUE
priority: high
complexity: medium
area: contacts, mail
found: "2026-09-04T11:56:49Z"
started: "2026-09-04T11:57:53Z"
session: 986bc24c-6a18-473f-a506-aa8c4efb475c
claimed: "2026-09-04T11:57:53Z"
---

# B272 — A transient mail failure tells a reader their code was wrong and loses the owner's notification for good

## Why

Observed end to end on fernscout.ch, 2026-09-04. A reader opened a guest
invite, gave their name and address, received the six-digit code, typed it in
correctly — and was told:

> **The code**
> That code didn't work. Check it and try again.

They then received the "Thank you" mail anyway, and the owner received nothing
at all while a request sat in the queue waiting to be let in.

The journal log says what happened:

```
13:49:06  [mail:smtp] lindenmann@… — "Your code for Viktorias Travels" -> 2.0.0 Ok
13:49:24  [mail:smtp] lindenmann@… — "Thank you" -> 2.0.0 Ok
13:49:34  ⨯ Error: AUTH PLAIN failed: 454 4.7.0 Temporary authentication failure:
          Connection lost to authentication server
```

So the code **was** right. `confirmContact` succeeded, the row was updated, the
reader's confirmation mail went. Ten seconds later `notifyOwnerOfRequest`
(`app/api/contacts/confirm/route.ts:58`) hit a transient SMTP auth failure, and
because it is `await`ed unguarded the exception left the route: `500`, and a UI
that renders any failure as *"That code didn't work"*.

Three separate defects, and the third is the one with no way back.

**The mail is not best-effort, though every reason it should be already exists
in this codebase.** `app/api/v1/journals/route.ts:235-239` wraps its welcome
mail exactly this way and says why: *"A journal whose welcome mail bounced is a
journal, not a failed creation, and rolling one back over a mail server having
a bad minute would be a much worse trade."* Confirming an address is the same
trade and takes the opposite side.

**The error message accuses the reader of mistyping** when the server broke.
This is somebody's first interaction with a stranger's journal, and it tells
them they got a six-digit number wrong. Whatever else changes, a failure that
is not a bad code must not say it is one.

**The owner's notification is unrecoverable.** `firstConfirmation` is
`row.confirmed_at === null` (`lib/contacts/index.ts:343`), and `confirmed_at`
was set by the attempt that then failed. So the notification is sent once, by
the one call that crashed, and re-confirming can never send it again — the
guard is deliberate ("Somebody re-confirming to recover their link should not
put a second request in front of the owner") and correct for its own case. The
result is a queue entry nobody is told about, permanently, and an owner who
finds out only by looking. Which is precisely the thing `notifyOwnerOfRequest`
exists to prevent: C16, *"a note to the owner so the queue is actually looked
at."*

## Work

1. **Both mails become best-effort**, in the shape `app/api/v1/journals/route.ts`
   already uses, so no mail failure can fail a confirmation. Log the failure —
   this one only surfaced because the stack trace happened to be in
   `journalctl`, and B257 is about that being a matter of luck.
2. **Report a server failure as a server failure.** Find where the UI turns the
   confirm response into *"That code didn't work"* and give a non-`401`
   response its own message: something happened at our end, the address is
   confirmed, nothing was lost. Do not invent a retry the code cannot make.
3. **Do not lose the owner's notification.** The honest fix is to send it from
   a state that survives the send failing rather than from the request that
   confirmed. Options worth weighing, not a decision made here: notify from the
   queue's own state (any confirmed contact never notified about), or record a
   `notified_at` on the row and let re-confirmation resend when it is null —
   which keeps the anti-duplicate guard while making it about the notification
   rather than about the confirmation. Whichever, an owner must end up told.
4. **The queue page should stand alone**, since a notification can always be
   lost to something. Check whether `/<user>/contacts` and the owner's own
   panel show a waiting count anywhere they would notice it, and capture
   separately if not.

Not in scope: the SMTP failure itself, which was genuinely transient and is the
mail provider's business.

## Acceptance

- A confirmation whose mails both fail still returns `ok`, and the reader is
  told they are confirmed.
- The UI never says the code was wrong for anything but a rejected code; a test
  asserts the two paths render differently.
- After a failed notification, the owner is still told — by resend or by the
  queue — and a test covers the case that produced this ticket: confirm
  succeeds, notification throws, owner ends up notified.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
