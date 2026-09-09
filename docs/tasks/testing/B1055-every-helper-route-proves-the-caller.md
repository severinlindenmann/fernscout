---
id: B1055
title: Every helper route proves the caller with a browser cookie, so nothing but a browser can speak to the helper
type: FEATURE
priority: high
complexity: medium
area: helper, auth, channels
found: "2026-09-09T07:11:40Z"
started: "2026-09-09T20:27:29Z"
merged: "2026-09-09T22:06:50Z"
---

# B1055 — Every helper route proves the caller with a browser cookie, so nothing but a browser can speak to the helper

## Why

`notYourJournal()` in `lib/helper/server.ts:39-95` is careful, deliberate, and
in the way. Every route under `app/api/helper/[user]/` calls `isHelperOwner`,
which resolves a browser cookie and **refuses a bearer token by construction**
— not ignores it, refuses it with an explanatory 404. The reasoning is sound
and is decision 24's: reading the site on a phone must not put a credential
that can rewrite it in a pocket.

A WhatsApp webhook has neither. It arrives from Meta, signed by Meta, carrying
a telephone number. There is no cookie to read and no bearer to refuse, and
the answer cannot be to hand the webhook a cookie — that would be minting a
browser session from an inbound message, which is exactly the thing the rule
above exists to prevent.

So the question the code cannot currently express is: *who is asking, and how
did they prove it?* Today that question has one answer shape (a cookie naming
an owner) baked into thirty-odd routes.

## Work

The lazy shape, and probably the right one: leave every existing route alone
and give the helper's *inside* a caller instead of a request.

- The tool layer already works on `username` plus plain strings —
  `runTool(username, …)`, `proposalFor(username, …)`, `answerInThread(username,
  …)`. Nothing below the route layer reads a cookie.
- So what is missing is one function above it: resolve a request or a webhook
  event to a `{username, how: "cookie" | "whatsapp" | …}` and refuse
  everything else. The routes keep calling `isHelperOwner`; the new door calls
  the same resolver with a different proof.
- **The proof for WhatsApp is a telephone number, and that is weaker than a
  mailbox.** Say so in the code where it is decided, and keep the money and
  the irreversible things behind the existing web pages (see B1061 and the
  postcard/photobook/credits pattern) rather than widening what the resolver
  returns.

Resist a `Caller` interface with one implementation until the second channel
actually exists. One resolver function and a discriminated union is the whole
of it.

## Work not being done

Changing what a cookie means, or letting a bearer token into `/api/helper/**`.
An agent that holds a token has `/api/v1` and that stays the deal.

## Acceptance

`answerInThread` and every tool run without a `Request` in scope, and a test
proves a WhatsApp-shaped caller reaches the same tools while still being
refused by every route that needs an owner's browser.
