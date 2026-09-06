---
id: B633
title: There is no way for the owner to send a day's notification from the day itself
type: FEATURE
priority: medium
complexity: medium
area: day page, digest, credits
found: "2026-09-06T17:51:45Z"
started: "2026-09-06T19:29:16Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T19:29:16Z"
---

# B633 — There is no way for the owner to send a day's notification from the day itself

## Why

Sending a day to the people following a trip already exists — `sendDayLetter`
and `sendDayWhatsapp` in `lib/digest/`, behind
`POST …/days/<slug>/send-mail` and `…/send-whatsapp`, with a cost estimator
(`lib/digest/dayWhatsapp.ts:192`) that answers what a send would take without
sending. What does not exist is a way for the owner to do it while looking at
the day. So the one person entitled to decide has to ask an agent, and cannot
see whether it has already gone out.

## Work

- On a day, to the owner only, a button that sends the notification.
- Before it sends, say what it will cost in credits and what the balance is —
  the estimator already answers both. Not enough credits: say so, and say where
  to top up, rather than failing at the send.
- Record that a day has been sent, and show that instead of the button. An
  owner must not have to remember; a second send to the same people is the
  failure this prevents.
- A cookie session only, like the postcard send button — a bearer token must
  not be able to press it.

## Acceptance

- As the owner, a day that has not been notified shows the button; pressing it
  asks for confirmation naming the credit cost and the balance, and sends.
- The same day afterwards says it has been sent, and offers no second button.
- With too few credits, the confirmation says so and nothing is spent.

## Decisions made while building

**One button, both channels.** The ticket says "the notification" as if there
were one; there are two (mail, WhatsApp). Rather than a channel picker, the
button sends whichever of the two are switched on for the journal and not yet
sent for this day — mirroring how `/publish` already offers both at once
behind `send_mail`/`send_whatsapp`. The quoted cost is the sum for whichever
channels are still pending. A channel that goes on *after* the other was
already sent still gets offered — `pending` is computed per channel, not as
one flag for the whole day.

**The "already sent" record did not exist and was added** —
`day_notifications` (migration `022-day-notifications.ts`), one row per
`(owner, trip, slug, channel)`. It cannot be read off `credit_ledger`: a send
whose only recipient is the owner's own free copy (B614) charges zero credits,
and `spend(owner, 0, …)` writes no ledger row at all, so a low-traffic journal
would look permanently "never sent". `lib/digest/dayNotify.ts`'s
`recordNotified` is called from inside `sendDayLetter` / `sendDayWhatsapp`
themselves on every `ok: true`, whatever the cost, so *either* door — this
button or the agent's `POST …/send-mail` — updates the same record.

**The route is `app/[user]/trips/[trip]/day/[slug]/notify/route.ts`, not under
`/api/v1/`** — the same placement decision as the postcard send button
(`app/[user]/postcards/[id]/send/route.ts`): an agent already has
`POST …/send-mail` and `…/send-whatsapp` to ask for a send, documented in
`/agent.md`; this is the door the person whose journal it is presses
themselves, cookie-only (`isOwner(user)` called without the request), and it
refuses a request carrying `Authorization` outright rather than falling
through to the cookie check. Being outside `app/api/v1` and `app/api/auth`
means it is deliberately outside `/openapi.json` and the contract tests that
police that surface — there is nothing here for an agent to call, so there is
nothing to document for one.

## Security review

`claude-security` could not be run over this change: the session had no
`Workflow` tool available (its scan pipeline runs only through
`claude-security:scan` and refuses to substitute a manual review for it), and
the plugin itself refuses direct invocation outside that pipeline. A future
session with `Workflow` available should run it properly over this diff.

In its place, a manual review of the money/auth path found one real issue and
fixed it before merging: **the route had no double-press guard.** `statusFor`
computed `pending` fresh on every call, so two concurrent `POST`s (a double
tap, a retried request) would both see the same channel as unsent, both pass
the credit precheck, and both call `sendDayLetter`/`sendDayWhatsapp` —
spending twice and mailing the whole readership twice. `lib/postcard/send.ts`
already has the answer to exactly this shape of bug (`claimForSend`, an
atomic rows-affected update before spending); this route now does the same
thing as an atomic insert-on-conflict (`claimChannel`/`releaseChannelClaim` in
`lib/digest/dayNotify.ts`, since there is no pre-existing row to claim the
way a `print_orders` row exists — the unique index from
`022-day-notifications` is what makes a concurrent second insert fail).
`test/day-notify-route.test.ts`'s "two presses at once" test fires both
`POST`s through `Promise.all` and asserts exactly one attempts a send.

Everything else considered and judged fine: the bearer-token refusal runs
before any owner check (no timing/info leak to an unauthenticated caller);
`isOwner(user)` is called without `request`, so a bearer token cannot satisfy
it via the cookie path; the credit precheck happens before any `spend` call on
every request, so a single request's own no-credits path is checked before
side effects, not discovered mid-send; `GET` never runs `statusFor` (which
touches the database) before the owner check, so an unauthenticated caller
gets a bare 403 and nothing computed; and `recordNotified`'s upsert (called
from inside `sendDayLetter`/`sendDayWhatsapp` on every successful send,
including the agent's own `send-mail`/`send-whatsapp`) is idempotent against
the row this route's `claimChannel` may have already inserted, so the two
mechanisms compose rather than race each other.
