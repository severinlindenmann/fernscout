---
id: B1024
title: The send dialog quotes a price and never says who gets the day
type: FEATURE
priority: medium
complexity: medium
area: components/DayNotify.tsx, app/[user]/trips/[trip]/day/[slug]/notify/route.ts
found: "2026-09-08T21:40:00Z"
started: "2026-09-08T19:43:52Z"
merged: "2026-09-08T20:13:58Z"
completed: "2026-09-09T16:45:40Z"
---

# B1024 — The send dialog quotes a price and never says who gets the day

## Why

The confirmation before a day goes out reads, in full:

> Der Versand kostet 0 Credit(s), danach bleiben dir 1179.00. Jetzt senden?

It is the one moment in the product where something leaves the house on the
owner's behalf, and it answers the wrong question. Two faults, and the second
is why the sentence above looks the way it does.

**It never says who.** `GET …/notify` answers with `pending:
["mail","whatsapp"]` — channel names, no counts. The numbers exist a return
value away: `mailWouldReach()` already returns a count
(`lib/digest/dayLetter.ts:446`), and `whatsappWouldCost()` builds the same
narrowed recipient list to price it (`lib/digest/dayWhatsapp.ts:249`). Nobody
asked the route to hand the counts over, so the panel cannot say "three
e-mails and one WhatsApp" even though the server knows exactly that.

**It quotes a price that does not exist.** `components/DayNotify.tsx:103`
branches on `balance === null` — whether credits are switched on at all —
rather than on `needed === 0`. Since B840 a letter costs nothing, so every
journal that *has* credits and sends only letters gets the paid sentence with
a zero in it, and the right sentence — `notify.confirmFree`, which is already
written in all three languages — is unreachable. It is a one-line branch and
it is what a person actually sees.

The two are one ticket because they are one line of code: B replaces the
message wholesale, so the free case stops being a separate sentence and
becomes the absence of a total.

## Work

Variant B of the design pass: one row per channel — icon, count, channel,
what that channel costs — then a rule, then the total and the balance after.
With nothing to pay, the rule and the total are simply not drawn.

- **The route** returns `pending: [{ channel, count, cost }]` instead of bare
  names. `mailWouldReach` exists; add `whatsappWouldReach` beside
  `whatsappWouldCost`, mirroring it exactly. Reach and cost are **not** the
  same number for WhatsApp — `chargeable()` excludes the owner's own free
  copy, which is still a message that gets sent — so both are needed.
- **The panel** renders the list. `alreadySent`, `reachable` and `short` are
  untouched.
- **Names are not shown, deliberately.** These are contacts with addresses,
  and a confirmation dialog is not where an address list opens. A count and a
  channel are what the decision turns on.

Not doing: **push**. `NotifyChannel` is `"mail" | "whatsapp"` and nothing
else (`lib/digest/dayNotify.ts:6`); the `push` capability exists with VAPID
keys and is not wired to this button. A third row would be a new channel with
its own recipients, claim and receipt — captured as **B1025**. The list is
built so that row costs nothing to add later.

The route is outside `/api/v1/`, refuses a bearer token outright, and is in no
published schema, so the contract does not move.

## What it looked like

Driven locally at 390px, signed in as `example`'s owner, mail and WhatsApp both
switched on.

- **The demo journal as it stands** — one row: `✉ 1 e-mail · free`, no total,
  no zero-credit sentence. The route answers
  `pending: [{channel:"mail",count:1,cost:0},{channel:"whatsapp",count:0,cost:0}]`.
- **A journal with a real list**, by intercepting that response — `✉ 3 e-mails ·
  free` / `💬 1 WhatsApp message · 2 credits`, a rule, then "That is 2 in all,
  leaving 1177.00." Plurals decline per row.

Three things learned on the way:

- **A channel with a count of zero had to be filtered out of the *view*, not
  the response.** "0 WhatsApp messages" is noise on screen, but `pending` is
  what the POST loop iterates and what `alreadySent` is derived from — dropping
  a channel server-side would make an unsent channel look sent.
- **The all-zero case is a question with nothing under it**, because
  `reachable` asks whether a channel is *configured*, never whether anybody is
  on it. Not new — the button has always been offered there — but newly
  visible, so it is captured as **B1027** rather than absorbed.
- **`1177.00` is not a formatting bug.** `formatCredits` keeps two decimals on
  purpose (B987): "1.50" and "1.5" are the same number to a programmer and not
  to somebody reading a receipt. Left alone.

`whatsappWouldCost` and the new `whatsappWouldReach` were made two one-line
wrappers over a shared `wouldSendTo()`, so the count and the price come off the
same narrowed list and cannot drift.

## Acceptance

- On a published day with contacts, the dialog names each channel with its
  count and its own cost, at 390px, without the panel needing a scroll to
  reach the buttons.
- A send that costs nothing shows no total and no balance — the zero-credit
  sentence is gone in all three languages.
- A send that costs something shows the total and what is left after, and
  `short` still refuses before spending.
- WhatsApp's count and its cost may differ by one (the owner's free copy) and
  both are right.
- `site/locales/{en,de,hu}.json` cover every new key; `npm run verify` clean.
