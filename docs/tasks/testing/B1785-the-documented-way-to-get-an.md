---
id: B1785
title: The documented way to get an agent token for any journal works only for the journal the admin address owns
type: ISSUE
priority: medium
complexity: low
area: app/api/auth/codes/redeem, get-a-credential
found: "2026-09-15T07:14:07Z"
started: "2026-09-15T07:38:25Z"
merged: "2026-09-15T07:46:18Z"
---

# B1785 — The documented way to get an agent token for any journal works only for the journal the admin address owns

## Why

`get-a-credential`'s first paragraph says `get-token.sh live <journal> agent`
always uses `agent@fernscout.ch`, "which is this instance's
`FERNSCOUT_ADMIN_EMAIL` and therefore an owner of every journal (B480)". The
live instance refuses it:

```
POST /api/auth/codes/redeem {"user":"severin","email":"agent@fernscout.ch","for":"write"}
→ 401 invalid_code
[auth] write token refused for severin: a write code with no trip on it, for an
address that is not the owner
```

`agentScope()` in `app/api/auth/codes/redeem/route.ts:197` compares the address
with `getUser(username)?.owner.email` — the journal's own owner — and not with
`isOwner`, which is where the admin's reach comes from. So an unscoped write
token is available to the admin address for `example`, which it owns, and for
nothing else. Found while verifying B1776 against the live instance: the check
had to be done on `example` instead.

The refusal is deliberately indistinguishable from a wrong code, for good
reasons, which is exactly why the documentation being wrong costs a whole
round of confusion — a correct code read out of the instance's own kept mail
comes back `invalid_code` and the obvious conclusion is that the mail reader is
broken.

Two possible right answers, and this is a person's call:

1. **The code is right and the documents are wrong.** Writing into somebody
   else's journal is not something an operator address should do silently,
   even on this instance. Then `get-a-credential` and `get-token.sh` need to
   say so, and an OPS run against a journal the admin does not own needs a
   different route (the owner's own address, or a trip-scoped code).
2. **The documents are right and the code is inconsistent.** Then `agentScope`
   should use the same `isOwner` the rest of the instance uses, and B480's
   reach would cover write codes too.

## Work

Decide which of the two it is, then make the other side agree. Whichever way it
goes, `get-a-credential/SKILL.md` and `.claude/skills/vps/SKILL.md` (gitignored,
this instance's own) must stop promising a token that cannot be had, and
`get-token.sh` should fail with the reason rather than with `invalid_code`.

Related: the same `vps` skill names `/api/auth/request` and `/api/auth/verify`,
which B1600 replaced with `/api/auth/codes` and `/api/auth/codes/redeem`. That
half is already corrected locally.

## Acceptance

`get-token.sh live <journal> agent` either returns a token for a journal the
admin address does not own, or fails immediately saying it cannot and why. No
skill claims the admin address owns every journal for the purpose of a write
code unless the code actually says so.

## Decided, 2026-09-15

**The code is right and the documents were wrong** — the owner's call, asked
and answered before anything was built. An operator address is not a shortcut
around the owner's authorisation for a write into their journal; `agentScope`
stays as it is, and `isOwner` is not widened to cover write codes.

## Built, 2026-09-15

Driving the live instance settled what the split actually is, which is the part
no document said:

- the **cookie** works for any journal — `get-token.sh live severin cookie`
  returns `fs_identity` + `fs_session`, and `/severin/me` renders as its owner
  (200). That is `isOwner` and B480 doing exactly what they promise.
- the **agent token** works only for the journal the address owns. `severin`
  is refused, `example` returns `fs_agent_…`.

So: `get-token.sh … agent` reads the journal's own `owner.email` first — over
ssh on the live box, from `CONTENT_DIR`/`.data/content`/`content` locally — and
refuses **before asking for anything**, naming the owner address and the three
routes that do work. No rate-limit slot and no mail are spent finding out. A
journal whose config cannot be read from here is not blocked: the preflight is
a courtesy, not a gate, and the refusal path also now points at the log line
that carries the real reason.

`get-a-credential/SKILL.md` says pages-not-API in those words, and
`docs/agents/network-and-auth.md` — where an agent reads about B480 — carries
the same sentence, since that paragraph was the source of the belief.
`.claude/skills/vps/SKILL.md` (gitignored, this instance's own) was corrected
in the same pass, along with its `/api/auth/request` → `/api/auth/codes` drift
from B1600.

### Evidence

```
$ get-token.sh live severin agent
agent@fernscout.ch cannot get a write token for 'severin' — that journal belongs to
lindenmann@severin.io, … Nothing was asked for.                          (exit 3)
$ get-token.sh live example agent
fs_agent_QyAFBdiKGPO…                                                    (exit 0)
$ curl -b /tmp/fernscout-severin-cookies.txt https://fernscout.ch/severin/me
200 · <title>Dein Zugang · Sevi + Viki's Travels
```

`npm run verify` — all 5 gates, 275s. `test/skill-docs.test.ts` is the keeper
`check:changed` selects for this path; 14 checks, green.

