---
id: B696
title: A journal called agent can still be created on an instance with its own config
type: ISSUE
priority: medium
complexity: low
area: auth, users
found: "2026-09-07T10:35:45Z"
started: "2026-09-07T11:40:32Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:32Z"
---

# B696 — A journal called agent can still be created on an instance with its own config

## Why

`site/config.json` now reserves `agent`, so nobody on this instance can claim
the name and collide with the route B681 added. That is the operator's list,
and it is only half the floor: `ALWAYS_RESERVED` in `lib/users.ts:40` is the
code-level one, additive under the config, and it is what protects an instance
running its own `FERNSCOUT_CONFIG` — which is every deployed instance, since
AGENTS.md says a deployment overrides that file so its config survives a
`git pull`.

So an operator whose config predates B681, or who wrote their own reserved
list, can still hand somebody the username `agent`, and `/agent` then belongs
to two things at once. `api`, `media` and the rest are hard-reserved in code
for exactly this reason.

Found while building B681; the ticket named `site/config.json` only, so it was
reported rather than widened.

## Work

Add `"agent"` to `ALWAYS_RESERVED` in `lib/users.ts`, beside the names already
there. Check whether any other route added since that list was written has the
same gap — `welcome` and `docs` are worth a glance.

## Acceptance

A journal cannot be created called `agent` on an instance whose own
`config.json` does not mention it. A test asserts it.

## Resolution

Added `"agent"`, `"docs"`, `"legal"` and `"s"` to `ALWAYS_RESERVED` in
`lib/users.ts:40`. `welcome` was already there; `docs` was the gap the ticket
pointed at, and a walk of `app/`'s top-level static routes turned up two more
of the same shape: `app/legal/page.tsx` (its own doc comment already claims
"legal is in the reserved usernames", true only of `site/config.json`'s list,
not the code-level one) and `app/s/[token]/page.tsx` (the buddy/guest invite
shortener — a username `s` would shadow `/s/<token>` the same way `agent`
shadows `/agent`).

Test: `test/multiuser.test.ts` — "reserves agent, docs, legal and s in code
even when a custom config omits them (B696)", against a server config that
only reserves `admin`.
