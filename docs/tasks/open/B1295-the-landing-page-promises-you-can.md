---
id: B1295
title: The landing page promises you can export everything, and somebody without an agent has no way to
type: ISSUE
priority: medium
complexity: medium
area: export, helper
found: "2026-09-10T11:01:13Z"
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
