---
id: B248
title: The main-checkout rule is prose, and prose does not stop an Edit
type: DOCS
priority: medium
complexity: low
area: Agent workflow
found: "2026-09-04T09:07:45Z"
merged: "2026-09-04T16:05:08Z"
---

# B248 — The main-checkout rule is prose, and prose does not stop an Edit

## Why

`AGENTS.md` says the main checkout stays on `main` and stays clean, and that
everything which is not a task file is built in a worktree. It is the rule the
whole parallel-agent setup rests on, and it is enforced by nothing: an agent
that has read the sentence and then edits `lib/entries.ts` in the main checkout
succeeds, and the next session's `git merge` is the thing that finds out.

Both failure modes are already on the record. B144 is a subagent that could not
use `EnterWorktree` because the guard reads the session's own working
directory. B201 is eighteen commits from four sessions found sitting on a
detached HEAD in the shared checkout, with nothing announcing it — recoverable
only because somebody looked.

`npm run tasks` now reports the state, which is detection after the fact. The
`hookify` plugin makes the other half available: a `PreToolUse` hook can refuse
an `Edit` or `Write` in the main checkout when the target is not under
`docs/tasks/`, at the moment it is attempted and with the reason attached.

Costs nothing to the repository if it stays out of it — see the Work section on
where the configuration has to live.

## Work

- A `PreToolUse` rule matching `Edit|Write|NotebookEdit`: refuse when the
  working directory is the main checkout (`git rev-parse --git-dir` is
  literally `.git`, not a worktree pointer) **and** the path is outside
  `docs/tasks/`. Message names the worktree recipe rather than just saying no.
- Decide where it lives. `.claude/settings.json` is gitignored, so a hook
  configured there protects this machine and no clone. Either accept that and
  document it, or add a tracked `.claude/settings.shared.json` — but not
  silently: a repository that requires a plugin to be workable is a different
  promise from the one `AGENTS.md` makes today.
- Not doing: enforcing the branch. `main` versus a feature branch in the shared
  checkout is B201's territory and `npm run tasks` already reports it.

## Acceptance

- An `Edit` to a file outside `docs/tasks/` in the main checkout is refused,
  and the refusal names the worktree command.
- An `Edit` to the same file inside `.claude/worktrees/<branch>/` succeeds.
- A `Write` to `docs/tasks/backlog/Bnn-*.md` in the main checkout succeeds —
  task files are the documented exception and must stay one.
- Whichever way the location question is decided, `AGENTS.md` says which, so a
  fresh clone knows whether it has the guard.
