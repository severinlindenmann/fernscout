---
id: B594
title: Re-run claude-security scan on B07's provider payment gate once Workflow is available
type: CHORE
priority: low
complexity: low
area: payments, safety-gates
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
