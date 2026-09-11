---
id: B1535
type: ISSUE
priority: medium
complexity: low
area: auth
title: "An agent code for the instance admin is refused on every journal they do not own"
found: 2026-09-11T20:45:00Z
---

# An agent code for the instance admin is refused on every journal they do not own

## Why

`FERNSCOUT_ADMIN_EMAIL` is documented (AGENTS.md, B480) as an address `isOwner`
answers yes for on every journal, and `.claude/skills/vps/SKILL.md` writes out
the round trip — request a code as `agent@fernscout.ch`, read it, verify — as
the way an agent gets a token for *any* journal on the instance.

It does not work. `/api/auth/request` accepts it and mails a code; the code is
correct and unexpired; `/api/auth/verify` answers `invalid_code` before
`verifyCode` ever runs, because `agentScope` refuses first
(`app/api/auth/verify/route.ts:99`). The operator line is the only place the
real reason appears:

    [auth] agent token refused for severin: an agent code with no trip on it,
    for an address that is not the owner

So `agentScope` reads the journal's own `config.json` owner and does not ask
`isOwner`/`lib/admin.ts`. Cost: the failure is indistinguishable from a wrong
code, it burns two of the five-per-quarter-hour `auth-request-agent` budget
per attempt, and the documented procedure sends the next session down the same
hole. It cost this session three requests and a journalctl read.

Note the uniform-refusal reasoning in that route is deliberate and correct —
the bug is the scope decision, not the opaque answer.

## Work

Decide which is true and make one of them so:

- `agentScope` should ask `isOwner` (or `lib/admin.ts` directly), so the
  operator address gets `write:content` on any journal — matching B480 and the
  skill; or
- the admin address deliberately does **not** mint agent tokens, in which case
  say so in `lib/admin.ts`'s doc comment, in AGENTS.md's admin paragraph, and
  fix `.claude/skills/vps/SKILL.md` and `get-a-credential`'s `get-token.sh`,
  which both document the broken round trip as the way in.

Not doing: changing the uniform `invalid_code` answer.

## Acceptance

A test covering `agentScope` with `FERNSCOUT_ADMIN_EMAIL` set and a journal
owned by somebody else, asserting whichever of the two the decision is — and,
if it is the second, no remaining doc or script telling an agent to try it.
