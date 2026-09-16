---
id: B1022
title: Nothing can produce the URL that reopens a conversation
type: ISSUE
priority: medium
complexity: low
area: helper, sessions
found: "2026-09-08T19:35:04Z"
wontDo: "Already built by B1109 the day after this was filed: app/api/helper/[user]/sessions/route.ts and the history panel in HelperRoom.tsx both exist and reopen a stored session."
---

# B1022 — Nothing can produce the URL that reopens a conversation

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`/agent?c=<session>` reopens a stored conversation, and nothing in the product
can produce that URL. `sessionId()` is used server-side to write rows and is
never returned to a caller; no route lists past conversations; the room draws
no history list.

So the feature works and is unreachable — which is the same shape as B959's
finding about postcards, and the second time in a fortnight: a mechanism built
honestly, and nothing that offers it.

`sessionsOf()` already exists (`lib/helper/sessions.ts`) and returns exactly
what a list needs — the session, when it ran, how many turns, and the first
thing said. It has no caller.

## Work

Something that lists them and links to them. The obvious place is the room
itself, and the obvious shape is not a sidebar: this is a thing somebody wants
occasionally, and the room's own rule is that it does not grow chrome for rare
things.

Worth deciding with B1016, which is moving the room's panes around and has just
established where rare things live.

## Acceptance

An owner can reach a conversation from last week without typing a URL, and the
URL they end up at is the one that reopens it.

## Closed unbuilt

Decided against on 2026-09-16 during a triage of every issue, chore, docs, ops and security ticket in the backlog. Already built by B1109 the day after this was filed: app/api/helper/[user]/sessions/route.ts and the history panel in HelperRoom.tsx both exist and reopen a stored session.
