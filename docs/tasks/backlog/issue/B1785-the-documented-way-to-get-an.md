---
id: B1785
title: The documented way to get an agent token for any journal works only for the journal the admin address owns
type: ISSUE
priority: medium
complexity: low
area: app/api/auth/codes/redeem, get-a-credential
found: "2026-09-15T07:14:07Z"
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
