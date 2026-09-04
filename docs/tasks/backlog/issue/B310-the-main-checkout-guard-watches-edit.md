---
id: B310
title: The main-checkout guard watches Edit and Write, and a heredoc walks straight past it
type: ISSUE
priority: medium
complexity: medium
area: Agent workflow, hooks
found: "2026-09-04T18:12:00Z"
---

# B310 — The main-checkout guard watches Edit and Write, and a heredoc walks straight past it

## Why

B248 shipped the guard: a `PreToolUse` hook on `Edit|Write|NotebookEdit` that
refuses a write in the shared checkout unless the target is a task file, a
gitignored file, or inside `.claude/worktrees/`. It works, and it closes the
door it was pointed at.

It is not the only door. A hook matches **tool names**, and `Bash` is a tool
name it does not match, so every one of these lands in the shared checkout
with nothing said:

```bash
cat > lib/entries.ts <<'EOF'
…
EOF
sed -i '' 's/foo/bar/' AGENTS.md
python3 -c "open('lib/x.ts','w').write('…')"
git checkout <branch> -- lib/
```

This is not a theoretical hole, and that is the part worth writing down: the
sessions this repository actually runs are told to prefer the shell. The
harness instruction is *"read files with cat, head, or sed -n, make file
changes with sed, heredocs, or short scripts, rather than using the dedicated
Read, Edit, or Write tools."* Ten transcripts on 2026-09-03 and 04 carried
2,229 Bash calls against 254 Edits and Writes. So the guard covers the tool a
session under those instructions reaches for *least*.

What it still buys is real and should not be undersold — an agent that has not
thought about the rule meets it the first time it edits a file, with the
worktree recipe attached, rather than at somebody else's merge. But a guard
that stops the careless path and not the common one should say so out loud
rather than be mistaken for a lock.

## Work

Decide between three, and the cheapest may be the right one:

- **A `Bash` matcher with a fast textual pre-filter.** A command hook that
  greps the command for a redirect, `sed -i`, `tee`, `cp`, `mv` or `git
  checkout --` against a path that is not under `docs/tasks/`. Cheap, no LLM
  call, and it will both miss things (`node -e`, a script that writes) and
  refuse harmless ones (a heredoc into `/tmp`). Tune for the second: a false
  refusal is a wasted turn, a miss is the status quo.
- **A `prompt`-type hook on `Bash`.** Accurate about intent, and it spends a
  model call on every shell command in a repository that runs several hundred
  per session. Almost certainly too expensive.
- **Accept the gap and detect instead.** `npm run tasks` already reports the
  shared checkout's state, and a `Stop` hook could say "the shared checkout is
  dirty and none of it is task files" at the end of a turn. Detection after
  the fact, which is what B248 set out to improve on — but it catches every
  path, including the ones a matcher cannot see.

Whichever is chosen, the guard's own docblock and the AGENTS.md paragraph must
stop implying the rule is enforced and start saying which half is.

**Not doing:** hardening against a determined agent. The guard is a guardrail,
not a sandbox — anything with shell access can defeat it, and the permission
system is the thing that governs that. This is about the honest accident.

## Acceptance

- A heredoc writing `lib/entries.ts` from the shared checkout is either
  refused, or reported before the turn ends — and the chosen behaviour is
  written in `AGENTS.md`.
- A heredoc writing into `/tmp`, into a worktree, or into `docs/tasks/` is not
  refused.
- `AGENTS.md` no longer lets a reader believe `Edit`-matching alone enforces
  the main-checkout rule.
