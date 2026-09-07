---
id: B696
title: A journal called agent can still be created on an instance with its own config
type: ISSUE
priority: medium
complexity: low
area: auth, users
found: "2026-09-07T10:35:45Z"
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
