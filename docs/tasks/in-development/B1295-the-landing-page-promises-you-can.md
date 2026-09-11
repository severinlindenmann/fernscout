---
id: B1295
title: The landing page promises you can export everything, and somebody without an agent has no way to
type: ISSUE
priority: medium
complexity: medium
area: export, helper
found: "2026-09-10T11:01:13Z"
started: "2026-09-11T16:26:43Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T16:26:43Z"
---

# B1295 — The landing page promises you can export everything, and somebody without an agent has no way to

## Why

The landing page's "Free, forever" list ends with

> ✓ **Export everything, whenever you like** — `pricing.freeExport`

`/<user>/export.zip` is the only way to do it, and it refuses a browser session
by design. `app/[user]/export.zip/route.ts:30` requires `mayActAsOwner` — an
**agent token** with unqualified `write:content` whose address matches
`config.json`'s `owner.email` — and answers a plain 404 to anything else. B231,
B240 and B1086 all argue for that, correctly: a buddy-scoped token once selected
the whole archive, and the refusal has to be indistinguishable from an unknown
journal.

Verified on the live instance: the owner's own cookie session, which opens
`/me`, `/contacts` and `/account`, gets **404** on `/test-mobile/export.zip`.

So the export exists for somebody holding a token, and the whole point of
`/agent` is the person who holds none — AGENTS.md: *"a person with no agent of
their own can reach one anyway, through a guided web helper at `/agent`"*. That
person can create a journal, write days, publish them, buy credits and order a
photobook, and cannot take their own words out. Nothing in the helper offers it;
nothing on `/me` or `/account` links to it.

The promise is on the front page, unqualified, in the list of what the free tier
includes.

## What needs deciding

The gate is right and should not be loosened. The question is what the person
without a token gets instead. Options, in rough order of cost:

- The helper hands over an export the way it hands over a photobook link — a
  one-off, expiring URL minted for a request the owner made in the room.
- A control on `/<user>/account` that mails a link, in the shape deletion already
  uses (`lib/deletions.ts`) — mail is already the second factor for the most
  destructive thing here, and this is the least destructive.
- Change the landing page to say what is true.

The last is honest and the worst product answer.

## Acceptance

- An owner who has never held an agent token can obtain their journal as a zip.
- `/<user>/export.zip` still answers 404 to a cookie session, a buddy token and a
  stranger.


## Decision, 2026-09-11 — build it, beside the way out

Asked whether "remove this feature" meant the promise or the capability, and the
answer was neither: **add the way in.**

**Where:** on `/<user>/me`, next to the *Delete this journal* section — the one
that reads *"This is the way out. It sends a link to the address that owns this
journal — nothing is deleted until you press the button in that mail, and
nothing can be put back afterwards."* An **Export** button there, using the same
shape: a link mailed to the address that owns the journal.

That pairing is the point. Leaving and taking your things with you are the same
moment, and the page that offers one should offer the other. It also means the
export is reached exactly the way the deletion is — nothing new to reason about,
and `app/[user]/delete/[token]/export.zip` already implements a single-use,
time-boxed, token-gated archive for a journal on its way out.

**So the work is to generalise that token from "a pending deletion" to "an export
request"**, and give it a button. Mirror the deletion token's shape rather than
inventing one: short-lived, single use, one archive. B1086 and B1387 already
reviewed that shape, including the deliberate exclusion of `config.json`.

The landing page's *"Export everything, whenever you like"* becomes true rather
than being deleted.

Not in scope: changing what the archive contains, or the agent-token route,
which keeps working as it does.
