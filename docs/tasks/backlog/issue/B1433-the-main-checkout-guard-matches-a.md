---
id: B1433
title: The main-checkout guard matches a path pattern, so it blocks edits in a different repository entirely
type: ISSUE
priority: low
complexity: low
area: harness, hooks
found: "2026-09-11T09:17:45Z"
---

# B1433 — The main-checkout guard matches a path pattern, so it blocks edits in a different repository entirely

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found while building B1400-B1402, whose code lands in the sibling
`fernscout-helper` checkout rather than this one.

`.claude/hooks/main-checkout-guard.mjs` refuses an Edit/Write unless the target
is under `docs/tasks/`, is gitignored, or is inside `.claude/worktrees/`. It
decides that from the **path pattern**, not from which repository the path is
actually in. So a perfectly legitimate edit to

    /Users/severin/Documents/GitHub/fernscout-helper/.claude/skills/publish/publish.mjs

is refused, because it looks like `.claude/skills/...` — even though it is in a
different git repository with its own history, which this repo's worktree rule
has no authority over.

The agent had to route every edit through Bash and `node -e` to get the work
done. That is a silent tax: it makes a clean task look like rule-breaking, and
it pushes work onto the one tool path the *other* guard deliberately watches.

Worth knowing, and the reason this is low rather than high: the paired
`PostToolUse` bash guard is hardcoded to this repo's own root, so it correctly
stayed quiet about writes elsewhere. Only the Edit/Write guard is over-broad.

## Work

Resolve the target to its real repository before deciding — e.g. compare
`git -C <dirname> rev-parse --show-toplevel` against this checkout's own root,
and allow anything outside it. Keep every existing allowance.

Note the hooks are gitignored and per-machine (AGENTS.md says a fresh clone has
no guard at all), so this is a change to local harness configuration, not to
the repository's own promise.

## Acceptance

An Edit to a file under another repository's `.claude/skills/` is allowed. An
Edit to this checkout's own `lib/`, `app/` or `components/` is still refused,
and `docs/tasks/`, gitignored paths and `.claude/worktrees/` still pass.
