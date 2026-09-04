---
name: work-on-a-task
description: Take one approved task from docs/tasks/open, build it in its own worktree and branch, verify it, and merge. Use when the user says "work on B03", "take the next task", "pick something up", "start on that", or hands over a task id. Ends at testing/ — a person moves a task to completed, never an agent.
---

# Work on a task

One task, one branch, one worktree, one merge. The task's markdown file is the
working record the whole way through — it is updated as you learn, not written
once and abandoned.

```
open/ ──take──▶ in-development/ ──merge──▶ testing/ ──human──▶ completed/
```

**REQUIRED BACKGROUND:** the lanes, the frontmatter and the two human gates are
in `manage-tasks`. This skill is what happens between them.

## The two rules

**1. Take from `open/` only.** `backlog/` is unreviewed capture. If `open/` is
empty, **say so, show what is in `backlog/`, and stop.** Do not promote
something yourself and then start it — that is the review gate, and stepping
through it is the one thing this workflow exists to prevent.

**2. Stop at `testing/`.** A task reaches `completed/` when a person has seen
it working. Not when the tests pass, not when it merged, not when you are
confident. Merging is yours; declaring it done is not.

## Steps

### 1. Take it

```bash
npm run tasks                       # what is in open/
```

Given an id, use it. Asked to pick, take the highest-priority task in `open/`;
ties break toward lower `complexity`, because finishing beats starting. Say
which you took and why.

Read the whole file before moving anything. If the task is already stale —
the code changed, the problem is gone, the fix landed some other way — say so
now rather than building it. That answer belongs in the file.

```bash
npm run tasks -- move B01 in-development
git add -A && git commit -m "B01: taken"
```

That move does two things: it stamps `started:` with the instant, and it writes
your own session into `session:`. **That is the claim** — you do not run
`claim` as well. If the script refuses because another session holds the task,
it is taken; pick something else rather than reaching for `--force`, unless you
can see the holding session is gone.

Commit the lane move **on main, before branching.** The lane and the hold are
how a parallel session sees the task is taken, and a move that only exists on
your branch is invisible until you merge — by which time it has stopped being
useful.

### 2. Branch and worktree, named for the task

The name is the id and the slug, lowercased: `b01-forwarded-for-trust`.

```bash
git worktree add .claude/worktrees/b01-forwarded-for-trust -b b01-forwarded-for-trust
```

**How you get into it depends on which kind of agent you are, and there are
two.** Both are supported; picking the wrong one wastes a turn on a refusal.

**If you are an interactive session** — a person is typing to you, and your
working directory is the main checkout — enter it with `EnterWorktree`, `path`
set to that directory. Project instructions directing worktree use is exactly
the condition that tool asks for, so this is a legitimate call; passing `path`
rather than `name` is what keeps the branch based on your local HEAD, which is
where the lane-move commit lives.

**If you were dispatched as a subagent, `EnterWorktree` will refuse you**, and
retrying will not help. It reads:

```
the current working directory is the repository root, not an isolated worktree
— switching is only available to sessions whose working directory is inside a
worktree
```

The guard is about the *session's* working directory, and a subagent inherits
its parent's, which is the main checkout. Five dispatched agents met this on
2026-09-03 and eleven more on 2026-09-04; it is the normal case, not an edge
one. **Use absolute paths instead** — every read, every write, every `cd` at
the head of a `bash` call. That is the supported path for a dispatched agent,
and it worked for sixteen of them across two days with the main checkout never
touched. B144.

It is a discipline rather than a guarantee, so treat it as one:

- Begin every `bash` call with `cd /abs/path/to/.claude/worktrees/<branch>`.
  An agent thread resets its working directory between calls, so a bare `git
  status` runs in the main checkout and tells you about somebody else's work.
- Never `git merge`, `git checkout`, `git push`, or create or remove a
  worktree. The parent session does those, serially, from the main checkout.
- Reading a file in the main checkout is fine. Writing one is not.

**What the parent does before dispatching**, because it is half the protocol
and was nowhere written down:

```bash
git worktree add .claude/worktrees/<branch> -b <branch>
cp -Rc node_modules .claude/worktrees/<branch>/node_modules   # macOS, near-instant
```

`cp -Rc` clones copy-on-write on APFS, so five copies cost almost no disk and
no time; `npm ci` in each worktree is minutes each. Then hand the agent the
**absolute** worktree path in its prompt, along with the task file's contents
and its acceptance criteria — a subagent has none of your context. Elsewhere,
or if the clone fails, `npm ci --prefer-offline` in the worktree.

`.claude/worktrees/` is gitignored and already holds worktrees from other
sessions. Never work in someone else's.

### 3. Research, and write down what you find

Read the code the task names before changing any of it. The **Why** section
was written from a particular reading, and it can be wrong or out of date.

**Update the task file as you go.** This is a required step, not tidying:

- The Why turns out to be incomplete or mistaken → correct it, and say what
  changed your mind.
- You find a second problem → that is a new capture in `backlog/`, not scope
  you silently absorb. Reference it by id from this task.

  **Get the id from the script, from inside your worktree.** Never pick the
  next free number by reading `docs/tasks/` and adding one:

  ```bash
  npm run tasks -- new --type ISSUE --priority low --complexity low \
      --area "…" --title "…"          # then write the Why/Work/Acceptance
  ```

  Your worktree's `docs/tasks/` is the snapshot taken when your branch was
  cut, so four agents branched from one commit read the same folder and reach
  the same answer — on 2026-09-03 four of them called it B130, and the
  renumbering that followed had to edit four captures *and* the prose in the
  four tasks that raised them. `new` asks every checkout and then reserves the
  number in the shared git directory, so no sibling session can be given it.
  B143.

  It is safe to run here: from a linked worktree it writes the capture and
  leaves `INDEX.md` alone, which is the objection that made agents hand-write
  these files in the first place.
- The approach in **Work** turns out to be wrong → rewrite it before building
  the other thing. A task whose Work section describes something nobody built
  is worse than one with no Work section.

Commit those edits with the code. Somebody reading the merge should see the
reasoning and the change together.

### 4. Build it

Subagents earn their place when the task splits into parts that do not share
state — an independent fix in two unrelated files, or a wide read across the
codebase whose output you only need the conclusion of. Give each one the task
file's contents and the acceptance criteria; they do not have your context.

A task that is one change to one file is not a task for a subagent.

Follow the repository's own rules in `AGENTS.md`: the dialect split, no paid
account to develop, capabilities absent rather than broken, secrets in the
environment, nothing personal outside `content/`.

### 5. Verify, against the task's own words

All four, every time, in this order:

```bash
npm run build && npx tsc --noEmit && npx eslint . && npx vitest run
```

The build is first because it writes `.next/types`, which is where Next puts
the typed-route definitions `PageProps`, `LayoutProps` and `RouteContext`
resolve against. A worktree that has never been built fails `tsc` on every
route file for that reason alone — sixty errors in code you did not write. Run
`npm ci` in the worktree first, or the build fails too. B100.

Then the task's **Acceptance** section, line by line. Each line either has
evidence — a command and its output, a test that failed before and passes now
— or it does not.

If a line cannot be demonstrated, the task is not finished. Say which line,
leave it in `in-development/`, and stop. Do not rewrite the acceptance criteria
to match what you built.

### 6. Merge, then hand over

**Check what you are merging into before you merge.** The main checkout is
shared, and on 2026-09-03 it was found on a detached HEAD with eighteen
commits from four sessions sitting on no branch — nothing announced it, because
`git commit`, `git merge` and `npm run tasks` all keep working while detached.
The next `git checkout main` anybody ran there would have rewound past all of
them. B201.

```bash
cd /Users/severin/Documents/GitHub/fernscout
git rev-parse --abbrev-ref HEAD     # must say "main"
git status --short                  # somebody else's uncommitted files block a merge
```

`npm run tasks` says both of these on its own now, from any checkout, so the
lane move at the end of step 1 has already told you. If it printed a detached
warning, **do not merge and do not check out a branch there.** The recovery is

```bash
git branch -f main HEAD && git checkout main
```

and it is safe **only** when `git merge-base --is-ancestor main HEAD` holds —
which is what the warning checks before printing it. If it says the branch has
diverged instead, stop and ask a person.

Uncommitted task files in the main checkout are the other way a merge is
refused before it starts (`Your local changes to the following files would be
overwritten by merge`). They belong to another session, they are task files, and
task files commit straight to main — so commit them, with a message saying whose
they are, rather than stashing or reverting somebody else's work.

```bash
git merge --no-ff b01-forwarded-for-trust
```

Verify once more on main after the merge — a merge that passes on the branch
can still fail against what landed while you worked. Then:

```bash
npm run tasks -- move B01 testing   # rewrites INDEX.md, here where it is true
git add -A && git commit -m "B01: merged, awaiting review"
git worktree remove .claude/worktrees/b01-forwarded-for-trust
git branch -d b01-forwarded-for-trust
```

That `move` is also what puts `INDEX.md` right after the merge, and the main
checkout is the only place it can be right: the generated block is a rendering
of the lane folders, and a worktree's folders are a snapshot from when its
branch was cut. If you merged several branches, `npm run tasks -- index` once
at the end covers them all.

Landing in `testing/` **drops your hold**, and that is correct: you are done,
and whoever verifies it is somebody else — often another agent. Do not claim it
back to keep an eye on it. A held ticket in `testing/` reads as "being
verified right now" to the next agent that looks.

If you entered with `EnterWorktree`, leave with `ExitWorktree` and
`action: "keep"` — it will not remove a worktree entered by path, so remove it
with git as above. A dispatched agent never entered one and has nothing to
leave; it also does not run any of this step. Report, and let the parent
merge.

Report: what the task was, what you changed, the evidence for each acceptance
line, and anything you captured into `backlog/` along the way.

### 7. Stop

**Do not move it to `completed/`.** Say plainly that it is in `testing/` and
what a person should look at to satisfy themselves — the page to open, the
command to run, the behaviour to try. That request is the deliverable.

## Red flags — stop

- `open/` is empty, so promoting something from `backlog/` to work on it.
- Moving a task to `completed/` because the tests pass.
- Editing the **Acceptance** section so the work qualifies.
- Merging with a failing check, intending to fix it after.
- Working directly in the main worktree because the change "is small".
- Absorbing a second problem into this task instead of capturing it.
- Choosing an id for a capture by reading `docs/tasks/` and adding one.
- Retrying `EnterWorktree` after it refused a dispatched agent.
- Merging into a main checkout you have not checked is on `main`.
- `--force` past another session's hold because you wanted that task.
- Holding on to a task after it lands in `testing/`.
- Finishing without touching the task file — you learned nothing worth
  recording, which is almost never true.
