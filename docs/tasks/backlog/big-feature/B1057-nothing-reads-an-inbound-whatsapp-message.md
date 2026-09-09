---
id: B1057
title: Nothing reads an inbound WhatsApp message, so the number can be written to and never answers
type: FEATURE
priority: high
complexity: high
area: whatsapp, webhook, security
found: "2026-09-09T07:11:41Z"
---

# B1057 — Nothing reads an inbound WhatsApp message, so the number can be written to and never answers

## Why

`lib/whatsapp/` sends and never listens. `cloud.ts` has two calls — upload a
photograph, send an approved template — and `types.ts:1` says why the message
type has no free-form variant: *"outside a 24-hour customer service window the
Cloud API accepts nothing else, and a publish notice is by definition
business-initiated."*

That is a complete and correct description of B365's feature. It is also why
the number this instance owns (+41 78 217 26 46, see B403) can be written to
by anybody and answers nothing. B386 is the wont-do that recorded the harm:
a footer promised *"STOPP zum Abbestellen"* to somebody's family over a
channel where nothing read a reply.

Everything downstream of this ticket — onboarding by chat, photographs from a
phone, a voice note becoming a day — needs one route that does not exist.

## Work

The route, and only the route. Model it on `app/api/webhooks/stripe/route.ts`,
which already solves the same three problems.

- `GET /api/webhooks/whatsapp` for Meta's `hub.challenge` handshake, gated on
  a verify token from the environment.
- `POST` for events. **Verify `X-Hub-Signature-256` over the raw body**, with
  the app secret from the environment — the Stripe route's discipline about
  reading the raw body before anything parses it applies exactly.
- **Idempotency.** Meta retries, and a retried photograph is a second
  photograph. `lib/idempotency.ts` already exists (it was moved out of
  `lib/mcp/` when MCP was removed) and the message `wamid` is the natural key.
- **Answer fast, work after.** Meta expects a prompt 200 and retries what it
  does not get; a model turn plus a tool round is not prompt. The `jobs` table
  exists; a queue per conversation is also what stops five photographs sent in
  four seconds becoming five interleaved model turns.
- Normalise the event into one inbound shape — text, image, audio, document,
  location, contacts, interactive reply — and stop there. What each becomes is
  B1058 through B1060.
- **A dry-run path, as every other provider here has.** AGENTS.md: no feature
  may need a paid account to develop or test. A fixture posted at the route
  must drive the whole chain locally with no Meta account.
- `features.whatsapp` gains an inbound switch, off by default, and
  `/api/health` explains what is missing when it is off.

Not doing: replying (B1056), identifying the sender (B1058), or any media
handling.

## Acceptance

A signed fixture posted to the route is accepted, an unsigned one is refused,
the same fixture posted twice does one thing, and none of it needs a Meta
account.
