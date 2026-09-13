---
id: B1651
title: get-a-credential drives auth routes that no longer exist, so the documented way in 404s
type: CHORE
priority: high
complexity: low
area: Skills
found: "2026-09-13T08:40:16Z"
merged: "2026-09-13T19:50:29Z"
---

# B1651 — get-a-credential drives auth routes that no longer exist, so the documented way in 404s

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Step 2 of the v2 migration replaced six auth doors with three: `POST
/api/auth/codes` (with a `for:` of `read`/`write`/`identity`/`signup`) and
`POST /api/auth/codes/redeem`. `/api/auth/request` and `/api/auth/verify` are
gone.

`.claude/skills/get-a-credential/get-token.sh` and its `SKILL.md` still drive
the old pair, so **the documented way to get a credential 404s**. Found during
the phase-3 replay (2026-09-13): the agent had to work the real flow out by
hand from `/api/v2/openapi.json` before it could begin.

That is worse than an ordinary stale doc. This skill is what every future
session and subagent reads to get signed in, so a session that trusts it
loses its first several turns to a dead endpoint and may conclude the
instance is broken rather than the instructions.

## Work

Repoint `get-token.sh` and `SKILL.md` at `/api/auth/codes` +
`/api/auth/codes/redeem`, including the `for:` argument, and re-run the script
against the live instance both ways (`agent` and `cookie`) rather than only
reading it.

While there: check the rest of the skill's claims against the deployed routes
— the handover mint and the keys door also moved off `/api/v1` in the same
step, to `/api/auth/{user}/…`.

## Acceptance

`.claude/skills/get-a-credential/get-token.sh live <journal> agent` returns a
usable token against fernscout.ch, and the same for `cookie`. Every route the
`SKILL.md` names resolves — no 404s.
