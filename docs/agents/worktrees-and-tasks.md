## Where the work happens

**The main checkout stays on `main`, and stays clean.** Do not branch it, do
not switch it, do not leave changes sitting in it. Everything else follows
from that:

| In the main checkout | Anywhere else |
| --- | --- |
| Task files — capture, lane moves, editing a task's own markdown. **Commit them freely, as often as you like; no ceremony, no branch.** | Every other change. Code, tests, docs, skills, config, content. |

Anything that is not a task file is built in a **worktree on its own branch**
and merged back:

```bash
git worktree add .claude/worktrees/<branch> -b <branch>
cp -Rc node_modules .claude/worktrees/<branch>/node_modules   # see below
# … build it there, verify it there …
git merge --no-ff <branch>          # from the main checkout
git worktree remove .claude/worktrees/<branch>
git branch -d <branch>
```

This repository is set up to run several agents at once, which is the whole
reason for the rule. Two of them editing one checkout is not a merge conflict —
it is one of them silently building on the other's half-finished work, or a
`git merge` refusing to start because somebody else's uncommitted change is in
the way. Both have happened here.

Task files are the exception because they are how parallel sessions *see* each
other: a lane move that only exists on your branch is invisible until you
merge, by which time it has stopped being useful. That is also why they are
committed straight to `main` rather than held back — an uncommitted task file
in the main checkout blocks the next agent's merge.

**On this machine a hook enforces the first half of that**, and B248 is the
record of why prose was not enough: an agent that had read the sentence and
then edited `lib/entries.ts` here succeeded, and the next session's `git merge`
was what found out. A `PreToolUse` hook on `Edit|Write|NotebookEdit` now
refuses a write in the shared checkout unless the target is under
`docs/tasks/`, is gitignored, or is inside `.claude/worktrees/` — and the
refusal carries the worktree recipe rather than only saying no.

**A hook matches tool names, though, and `Bash` is not one of them** — a
heredoc, `sed -i` or a short script wrote here with nothing said, and those are
the calls these sessions make most. B310 closed that, and the shape of the fix
is worth knowing because the obvious one is wrong: parsing a command line for
write shapes is a list that is always missing its next entry — `tee`, `>>`,
`install`, an npm task — and every entry it does have is a false positive
waiting to happen (`grep foo > /dev/null`). So a second hook asks git
*afterwards* instead. `PostToolUse` on `Bash`, one `git status --porcelain`:
if the shared checkout is dirty in a way the rule does not allow, it names the
files and hands over the recipe for moving them into a worktree. That reads
real state rather than guessing at text, and catches every mechanism at once
including the ones nobody has thought of.

It detects rather than prevents, and that is the honest trade — detection that
never misses beats prevention that usually does. So read both guards as the
thing that catches the honest accident, not as a lock: the rule above is still
the rule, and it is still yours to keep.

**Neither is in the repository, and a fresh clone has no guard at all.** They
live in `.claude/settings.json`, `.claude/hooks/main-checkout-guard.mjs` and
`.claude/hooks/main-checkout-bash-guard.mjs`, all gitignored, because a
repository that requires somebody's harness configuration to be workable is a
different promise from the one this file makes. Installing them elsewhere is a
`PreToolUse` entry matching `Edit|Write|NotebookEdit` with a script
implementing those three allowances, and a `PostToolUse` entry matching `Bash`
with one that ignores `docs/tasks/`, ignores what git ignores, and stays quiet
while a merge or rebase is in progress.

Four things that follow, and are easy to get wrong:

- **One git command per shell call, when your session is worktree-isolated.**
  The harness checks that a command cannot escape the worktree, and it refuses
  what it cannot verify rather than guessing — `cd <worktree> && git log … &&
  git diff …` comes back as *"too complex to verify that it stays inside the
  worktree"*, and so does anything that `cd`s to the shared checkout. Forty-
  eight commands of that shape were written across ten sessions on 2026-09-03
  and 04; twelve were refused, each one a wasted turn. Chaining reads with
  `&&` is a habit worth keeping everywhere else and dropping here: run
  `git log --oneline main..HEAD`, then run `git diff --stat`, and let the merge
  into the shared checkout be its own call from the shared checkout.
- **A worktree has no `node_modules`.** `npx tsc`, `eslint` and `vitest`
  resolve upward and appear to work; `npm run build` does not. Clone the main
  checkout's with `cp -Rc` — copy-on-write on APFS, so it is about eight
  seconds and no real disk — rather than `npm ci`, which is minutes and was run
  sixty-five times in one week here. **Not a symlink**: `npm run build` then
  dies in Turbopack with *"Symlink [project]/node_modules is invalid, it points
  out of the filesystem root"*, and `verify` fails at step one for a reason
  that has nothing to do with the change. On a filesystem without `cp -Rc`,
  `npm ci` is still the answer.
- **That clone is a snapshot, and goes stale the moment `main` moves past it.**
  Merge `main` into a worktree cut a week ago and the lockfile can have moved
  while the cloned `node_modules` did not, so the build dies with something
  like `Module not found: Can't resolve 'tz-lookup'` — in a file the change
  never touched, from a dependency the change has nothing to do with. That
  symptom, not a broken merge, is what it means: check
  `git diff --stat <old>..HEAD -- package-lock.json`, and if it moved,
  re-run `cp -Rc`. Three sessions read this as a broken merge on 2026-09-09
  before finding the real cause. B1141.
- **Two sessions building the same checkout collide on `next`'s own build
  lock, not on each other's code.** `npm run verify` in the shared checkout
  while another session's build is still running dies with `⨯ Another next
  build process is already running`; `verify` now says so and tells you to
  wait rather than printing its generic "this tree is not ready". A worktree's
  own `.next` never collides with anything — only two verifies in the *same*
  checkout do. B1046.
- **`.claude/worktrees/` already holds other sessions' work.** Never work in
  one you did not create, and never assume `main` is ahead of them — an id or
  a change captured in a sibling worktree has not reached `main` yet.
- **Check the shared checkout is on `main` before merging into it**, with
  `git rev-parse --abbrev-ref HEAD`. Nothing about a detached HEAD announces
  itself: `git commit`, `git merge` and `npm run tasks` all keep working, the
  commits are real and reachable from `HEAD`, and they are on no branch. It has
  happened once, with eighteen commits from four sessions on it, and the next
  `git checkout main` would have rewound past all of them into a per-checkout
  reflog nobody reads. The recovery is

  ```bash
  git branch -f main HEAD && git checkout main
  ```

  and it is safe **only** when `git merge-base --is-ancestor main HEAD` holds.
  If it does not, the branch has diverged and that is a person's decision.
  `npm run tasks` now says all of this by itself, from any checkout, about
  every checkout — including that this one is halfway through a merge. B201.

**A dispatched subagent cannot use `EnterWorktree`** — the tool's guard is
about the session's own working directory, and a subagent inherits its
parent's. It works with absolute paths instead, and the parent creates the
worktree and hands over the path. Both halves are written out in
`work-on-a-task` step 2. B144.

## Tasks

Everything to build and everything found broken is a markdown file in
`docs/tasks/`. **The folder it sits in is its status** — there is no `status:`
field, because a status kept in two places disagrees with itself within a
month.

```
backlog/ ──person──▶ open/ ──take──▶ in-development/ ──merge──▶ testing/ ──person──▶ completed/
```

```bash
npm run tasks                       # counts plus active work and holders
npm run tasks -- list --lane open   # one lane
npm run tasks -- show B01           # one complete task
npm run tasks -- search "words"     # matching tasks, capped unless --all
npm run tasks -- new --type ISSUE --priority high --complexity low \
    --area "…" --title "…"          # always lands in backlog/
npm run tasks -- move B01 testing
npm run tasks -- claim B01          # say you are on it, without moving it
npm run tasks -- tidy               # re-file into the category folders
```

**The lane that accumulates is filed into category folders.** `backlog/`
holds its tasks one level down — `security/`, `issue/`, `big-feature/`,
`small-feature/`, `chore/`, `ops/`, `docs-and-skills/`, `superseded/`,
`wont-do/` — because a flat directory of a hundred and twenty is one nobody
reads to the bottom of. `testing/` used to as well, until B1110: what a
person now reviews from is the run report, not a browse through
`testing/security/`, so a ticket landing there is filed flat. The other
lanes stay flat too: they are transient, and more decisions per lane move
would buy nothing.

**You never choose the folder.** It is derived from `type` and `complexity`,
the same way the status is derived from the lane and for the same reason — a
fact kept in two places disagrees with itself within a month. `new` and `move`
file the task themselves, `npm run tasks -- tidy` re-renders the whole tree
from the frontmatter, and `test/task-ids.test.ts` fails when a file is not
where its frontmatter puts it. Correcting a `type:` and running `tidy` is how
a task changes category; moving the file by hand is how the two drift apart.

Two of the six types exist for work that is not code, and getting them right
is what keeps the folders worth having:

| `type:` | For |
| --- | --- |
| `SECURITY` `ISSUE` `CHORE` | as before |
| `FEATURE` | `complexity: high` files under `big-feature/`, anything else under `small-feature/` |
| `OPS` | an engagement against the **running** instance — enable a capability and drive it, run the restore drill, attack the live surface. The deliverable is findings and other tasks, not a diff |
| `DOCS` | the deliverable is words somebody reads — `AGENTS.md`, a skill, the agent guide, a doc comment, the demo content that teaches the model |

**Two fields override the type**, and both are ways of closing a task without
deleting it and without claiming a person verified it. Ids are forever, so a
closed task keeps its file and its number and stops appearing among live work.

`superseded:` carries what overtook the task — an id, or what was found — and
files it under `superseded/`.

`wontDo:` carries why a person decided it should not be built at all: the
behaviour is wanted as it is, the cost is not worth it, or the premise was
wrong. It files under `wont-do/`.

The distinction is worth keeping because the two invite opposite follow-ups. A
superseded ticket points at the work that replaced it, and the next agent may
usefully go and read that. A wont-do ticket points at nothing, and is meant
**not** to be reopened by the next agent hunting for something useful — which
is exactly what happens if "we decided against this" is filed as though the
work were still owed. `superseded` wins when both are set: "already done
elsewhere" is a fact about the code, "not worth doing" is a judgement about it,
and the fact is the more useful thing to show.

`wontDo` is a person's word, not an agent's. Set it when you have been told to;
capturing your own opinion that a ticket is not worth building is a `backlog/`
note, not a closure.

**A task in flight says which agent is on it.** Moving into `in-development/`
writes your session into `session:`, and taking a task another session holds is
refused rather than warned about. Every other arrival drops the hold —
`testing/` included, because the agent that merged is not the one that
verifies. That is what `claim` is for: a ticket being verified has to stay in
`testing/`, so there is no lane move to hang the claim on. The lane stamps
(`found:`, `started:`, `merged:`, `completed:`) are whole UTC instants, since
a task can cross three lanes in an afternoon here.

**Anything you notice goes into `backlog/`, always.** A second problem found
while building is a new capture referenced by id, never scope quietly absorbed
into the task you are on.

**Two lanes are a person's, and an agent moves a task into them only when told
to, in that turn, for that id.** `open/` is the way in: it is the reviewed
queue that makes "find yourself something useful" a safe instruction, so
promoting your own capture and then starting it skips the only review step in
the loop. `completed/` is the way out: a task is done when a person has seen it
working, not when its tests pass. **An agent stops at `testing/`** and says
what to look at.

If `open/` is empty and you were asked to pick something up: say so, show what
is in `backlog/`, and stop.

The id is the only way tasks refer to each other, so it means one thing
forever: task files are moved, never deleted. Reference other tasks **by id in
prose** — `see B01` — never by relative path, because files move between lanes
and a path link breaks when one does.

**Always take an id from `npm run tasks -- new`, including from a worktree.**
Never read `docs/tasks/` and add one. `nextId()` asks every checkout rather
than the one you are standing in (B99) and then reserves the number in the
shared git directory, so two sessions in the same second cannot both be given
it (B143). Choosing by hand is how four agents branched from one commit all
called their capture B130, and a duplicate is permanent: two files claiming one
id have different filenames, merge cleanly, and render as two happy rows.
`test/task-ids.test.ts` fails on a duplicate, on a file whose name and
frontmatter disagree, and on a reference to an id that does not exist.

Never hand-edit the tables in `INDEX.md`; they are generated between the
markers by `npm run tasks`. **They are generated in the main checkout only** —
run from a linked worktree, the script says so and leaves the file alone,
because a worktree's lanes are the snapshot from when its branch was cut and
the regenerated block both reinstates stale rows and conflicts with every other
branch in flight. `npm run tasks -- index` on `main` after merging is what puts
it right.

A task's **title is the problem, not the fix** — "X-Forwarded-For is taken on
trust" survives being wrong about the remedy, "Add header_up to the Caddyfile"
decides the solution before anyone has looked. Its body is **Why** (with
`file:line`, and what it costs), **Work** (including what you are *not* doing)
and **Acceptance** (a command, a behaviour, a test that fails now). Update the
file as you learn: a Work section describing something nobody built is worse
than none.

`manage-tasks` and `work-on-a-task` in `.claude/skills/` are the two skills
that carry all of this in full.
