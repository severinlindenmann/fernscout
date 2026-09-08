---
id: B594
title: Re-run claude-security scan on B07's provider payment gate once Workflow is available
type: CHORE
priority: low
complexity: low
area: payments, safety-gates
wontDo: "the operator does not want it — B07 was read by hand at the time and nothing since has suggested a finding"
found: "2026-09-06T14:32:19Z"
---

# B594 — Re-run claude-security scan on B07's provider payment gate once Workflow is available

## Why

B07 (`lib/photobook/providers.ts`, `lib/postcard/providers.ts`) added a
fail-closed payment gate on every print-provider request builder — an
auth/money-adjacent change AGENTS.md says must go through the `claude-security`
skill before merging. That session's dispatched security agent found the
`Workflow` tool absent and correctly refused to fake a scan; B07 shipped on a
manual read of the diff instead (no route, no DB write, no secret touched, only
a new throw on an empty string), recorded honestly in the task file rather than
skipped.

## Work

Once a session has `Workflow` (check `/config` for a "Dynamic workflows" row),
run `claude-security:scan` with `range=diff:<merge-base>..<B07's merge
commit>`, scope limited to the two `providers.ts` files, `scripts/photobook.ts`,
`scripts/postcard.ts`, and the two touched test files. Read the findings; file
each as its own backlog capture or note in this file why it doesn't apply.

## Acceptance

- The scan actually ran (not another "Workflow unavailable" refusal).
- Its findings are triaged: captured or dismissed with a reason, here.

## Reached and deliberately not run (2026-09-08)

Left in `backlog/` on purpose. `Workflow` exists in this session, but the
session was instructed not to use workflows, and `claude-security:scan` is
nothing but a workflow — so running it was not this session's to do, and
faking the outcome is the exact failure this ticket was opened about.

Still the right ticket, still needs a session that may use `Workflow`. The
range and scope in **Work** above are unchanged and still correct.


## Closed (2026-09-08)

Closed by the owner rather than run. B07's change was a fail-closed `throw` on
an empty string in two request builders — no route, no database write, no
secret touched — and it was read by hand at the time and recorded honestly as
such. Nothing in the year since has suggested a finding hiding in it.

This closes the *re-run*, not the standing rule: AGENTS.md still says an
auth-or-money-adjacent change goes through `claude-security` before merging,
and that is unchanged for the next one.
