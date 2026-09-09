---
id: B1144
title: A dispatched worktree agent cannot run claude-security, so the one skill work-on-a-task requires on an auth change is the one it cannot reach
type: DOCS
priority: high
complexity: low
area: skills
found: "2026-09-09T18:35:10Z"
---

# B1144 — A dispatched worktree agent cannot run claude-security, so the one skill work-on-a-task requires on an auth change is the one it cannot reach

## Why

`work-on-a-task` step 6 says: a change touching auth, tokens, grants,
visibility or an API route runs the `claude-security` skill over the branch
before merging. The phone-and-WhatsApp group (B1064, B1065, B1057, B1058) was
all five of those at once — a new identity, a signup gate, a webhook
signature, rate limits, a new session-adjacent field.

The dispatched group agent could not run it. `claude-security`'s orchestrator
needs the `Workflow` tool, and a subagent dispatched into a worktree does not
have it. So the one skill the rules require on exactly this kind of change is
the one a dispatched builder structurally cannot reach — and `run-a-batch`
dispatches every build as exactly that kind of subagent.

The agent did the honest thing: a manual focused pass, which found three real
issues and fixed them (a timing-unsafe token compare, phone numbers reaching
filesystem paths unvalidated, a wrong-capability check). But "the agent
improvised a substitute" is not the guarantee the rule was written to give,
and the next agent will hit the same wall with no way to know a fuller scan
was skipped.

This is a gap in the flow, found on its first real auth-touching batch — not a
defect in any one ticket.

## Work

Decide where the security scan runs when the builder cannot run it, and write
it into `run-a-batch` and `work-on-a-task` so it is not left to a subagent's
judgement. Candidates, for a person to choose between:

- **The orchestrator runs it after the merge, before the wave deploys.** The
  main session has `Workflow`. The cost is that a finding then lands after the
  merge rather than before it — but findings are captures for `backlog/`
  anyway, never merge blockers, so this may be no loss.
- **The orchestrator runs it on the branch before merging**, from the main
  checkout against the worktree's ref. Keeps "before merge" but couples the
  orchestrator to each group's branch.
- **A dedicated verifier subagent** with `Workflow` in its tool list, if that
  is grantable to a dispatched agent.

Whichever, the manual-pass fallback stays documented as what to do when the
tool genuinely is not available, rather than being the silent default.

## Acceptance

- `run-a-batch` says where the security scan runs for an auth-touching group,
  and it is a step the running agent can actually execute.
- `work-on-a-task` step 6 notes the dispatched-agent limitation and points at
  that step rather than asking a subagent to run a tool it does not have.
