---
id: B1433
title: The main-checkout guard matches a path pattern, so it blocks edits in a different repository entirely
type: ISSUE
priority: low
complexity: low
area: harness, hooks
found: "2026-09-11T09:17:45Z"
wontDo: ".claude/hooks/main-checkout-guard.mjs is gitignored and per-machine, so there is nothing in the tracked repository to change, test or merge. Hand-apply it on the machine that needs it."
---

# B1433 — The main-checkout guard matches a path pattern, so it blocks edits in a different repository entirely

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

## Not fixable from inside this checkout — here is the corrected matcher

`.claude/hooks/main-checkout-guard.mjs` and `.claude/settings.json` are
gitignored (confirmed: a fresh worktree — `.claude/worktrees/b1191-1433-tooling/`
here — has no `.claude/hooks/` at all). There is nothing in the tracked
repository to change, and nothing here to run the guard's own test suite
against, so this cannot be verified from a worktree either. This ticket
carries the fix a person applies by hand to their own `.claude/hooks/`.

**Root cause**, reading the current file: it already asks git for the
target's own repository root (`git rev-parse --show-toplevel` from the file's
directory, line ~90) and correctly refuses only when *that* root has a
distinct `--git-dir`/`--git-common-dir` pair (i.e. is itself a linked
worktree of a *different* repo). But it never compares the target's resolved
root against *this* checkout's own root — so a file that is simply in another
repository's main checkout (not a worktree of it) sails past that check and
is then judged by path shape alone (`docs/tasks/`, `check-ignore`), which is
where `fernscout-helper/.claude/skills/publish/publish.mjs` gets caught: it
is not under `docs/tasks/` and is not gitignored *in that repo*, from this
guard's point of view, so it falls through to the deny.

**The fix** — add one comparison, right after `root` is resolved, before any
of the worktree/task/gitignore checks below it:

\`\`\`js
import { fileURLToPath } from "node:url";
// ...
// This file lives at <this checkout>/.claude/hooks/main-checkout-guard.mjs,
// so two directories up is the one checkout this guard is allowed to police.
// A target resolving to any other repository's root — main checkout or
// worktree — is none of this guard's business.
const THIS_CHECKOUT_ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
// ...
const root = git(["rev-parse", "--show-toplevel"], from);
if (!root) allow();
if (path.resolve(root) !== THIS_CHECKOUT_ROOT) allow();
\`\`\`

Keep every check after it unchanged — the worktree, `docs/tasks/` and
`check-ignore` allowances still apply for edits that *are* inside this
checkout, this only adds the missing "is it even this repository" gate in
front of them. Deriving the checkout root from the hook's own file location
(rather than hardcoding a path, or trusting `process.cwd()`, which a
subagent's tool call may not set to the checkout root) means the same file
works unmodified if this checkout is ever cloned somewhere else.

No test accompanies this: the hook is gitignored, has no copy in any
worktree, and Vitest here cannot invoke a `PreToolUse` hook at all — there is
no harness in this repository that runs it. A person applying this by hand
should smoke-test it directly: `echo '{"tool_input":{"file_path":"/path/outside/this/repo/x"},"cwd":"..."}' | node .claude/hooks/main-checkout-guard.mjs` and confirm it now exits with no `deny`.

## Closed unbuilt

Decided against on 2026-09-16 during a triage of every issue, chore, docs, ops and security ticket in the backlog. .claude/hooks/main-checkout-guard.mjs is gitignored and per-machine, so there is nothing in the tracked repository to change, test or merge. Hand-apply it on the machine that needs it.
