---
name: manage-tasks
description: Track a feature, bug or chore in docs/tasks — capture it into backlog, work it through open, in-development and completed. Use when the user asks for a new feature, reports a bug, says "add this to the backlog", "what should I work on next", "pick something up", "start on B03", or when work finishes and something needs closing.
---

# Manage tasks

Everything to build and everything found broken lives in `docs/tasks/`, one
markdown file per task. **The folder the file sits in is its status** — there
is no `status:` field, because a status kept in two places disagrees with
itself within a month.

```
docs/tasks/
  backlog/           captured, not yet reviewed — write anything here
  open/              reviewed and approved; work may be taken from here
  in-development/    somebody is on it now
  testing/           merged, waiting for a person to try it
  completed/         verified by a person, kept as the record
```

**`backlog/` and `testing/` are filed one level deeper**, into category
folders, because they are the two lanes that accumulate — seventy-five and a
hundred and twenty-one on 2026-09-04, and a flat directory of that size is one
nobody reads to the bottom of:

```
docs/tasks/backlog/
  security/          SECURITY
  issue/             ISSUE
  big-feature/       FEATURE, complexity: high
  small-feature/     FEATURE, anything less
  chore/             CHORE
  ops/               OPS — an engagement against the running instance
  docs-and-skills/   DOCS — the deliverable is words somebody reads
  superseded/        overtaken by other work; see `superseded:` below
```

**You never choose the folder, and you never move a file into one by hand.**
It is derived from `type` and `complexity` — the same reasoning as the lane,
one fact in one place. `new` and `move` file the task for you;
`npm run tasks -- tidy` re-renders the whole tree from the frontmatter; and
`test/task-ids.test.ts` fails when a file is not where its frontmatter puts it,
which is how a `type:` edited in place gets noticed. To recategorise a task,
change its `type:` and run `tidy`.

Building one is `work-on-a-task`. This skill is the bookkeeping around it.

```bash
npm run tasks                          # what is in each lane, and who is on what
npm run tasks -- move B03 completed
npm run tasks -- tidy                  # re-file after editing a type by hand
```

## What the frontmatter records as work happens

Two things the script writes and you do not. Both exist because several agents
run here at once.

**When it moved.** `found:`, `started:`, `merged:` and `completed:` are whole
instants in UTC — `2026-09-03T19:07:32Z` — one per lane arrival. They used to
be dates, which in an afternoon that moves a task through three lanes said only
"a Tuesday"; B01 was found, started and merged on `2026-09-01` and its file
cannot say in what order. Tasks captured before B145 keep their date-only
stamps and are deliberately not backfilled: a midnight instant would be a time
nobody recorded.

**Who is on it.** `session:` is the agent session holding the task now, and
`claimed:` is when it took it. `move` and `claim` fill them in from
`$CLAUDE_CODE_SESSION_ID`; you never type them. Nothing is a person's to hold —
running the script by hand leaves both absent, which reads correctly as "free".

## The two gates

Three lanes an agent moves tasks through freely — `backlog/`,
`in-development/`, `testing/`. Two it does not:

**`open/` — the way in.** Anything you notice goes to `backlog/`; `new` writes
there and that is the only lane an agent adds to. Only a person promotes
`backlog/ → open/`, because `open/` is the queue that makes "find yourself
something useful" a safe instruction. Promoting your own capture and then
starting it converts "I noticed something" into "I decided this project needs
it", and skips the one review step in the loop.

If `open/` is empty and you were asked to pick something up: **say so and
stop.** Show what is in `backlog/` and ask which to promote. Do not promote,
do not take the highest-priority backlog item, do not start "the obvious one".

**`completed/` — the way out.** A task is done when a person has seen it
working, not when its tests pass. An agent takes work as far as `testing/` and
says what to look at; the last move is the author's.

An agent runs `move … open` or `move … completed` only when told to, in that
turn, for that id. The script prints a reminder when either lane is the
target — it is a note, not a permission.

## The hold, and why it is a refusal

The lane says *somebody* is on a task. It has never said **which session**, and
two agents reading `in-development/` could each decide the other's work was
theirs to continue — B143 and B144 are one afternoon of exactly that.

```bash
npm run tasks -- move B03 in-development    # taking it is the claim
npm run tasks -- claim B03                  # say you are on it, lane unchanged
npm run tasks -- release B03                # let go
```

Moving into `in-development/` takes the hold. **Arriving anywhere else drops
it**, `testing/` included — and that one is deliberate. The agent that merged
is not the agent that verifies, so a hold left behind by the builder would tell
every verification agent that the whole lane was taken. Whoever picks a ticket
up in `testing/` runs `claim`, which is the only way to say so without moving
a task out of a lane a person has to move it out of.

Taking a task somebody else holds is **refused**, not warned about — a warning
is not a lock, and an agent reads one and carries on. The refusal names the
holder and how long the hold has stood:

```
B03 is held by session a4b53c2f, for 4h.
If that session is gone, take it with --force.
```

`--force` is how a dead session's hold is broken. There is no timeout: a lease
that expires on its own would need this repository to be right about how long
an agent takes, and it would rather be asked.

## Steps

### 1. Capture — anything, any time

```bash
npm run tasks                      # is it already listed?
grep -ril "<keyword>" docs/tasks/
```

Never open a second task for something already listed. Close but not the same?
Reference it by id in the new one (`related to B01`).

```bash
npm run tasks -- new \
  --type SECURITY --priority high --complexity low \
  --area "rate-limiting, deploy" \
  --title "X-Forwarded-For is taken on trust"
```

The script assigns the next id, writes into `backlog/` and regenerates
`INDEX.md`. The id is one past the highest on disk, which is why task files are
moved and never deleted — delete one and the next task takes its number, and
every reference to the old id now points at something else.

**Run this even when you are in a worktree, and never choose an id by hand.**
Writing the markdown file yourself is easy — the frontmatter is six fields and
the shape is obvious from any neighbour — and it is how the ids collide. Your
worktree's `docs/tasks/` is the snapshot taken when the branch was cut, so
every sibling session reading it reaches the same answer: on 2026-09-03 four
agents branched from one commit all called their capture B130, and the
renumbering had to touch each capture *and* the prose in the task that raised
it. The script does what a reading of one folder cannot — it asks every
checkout (B99), and then reserves the number in the shared git directory so two
processes in the same second cannot both be handed it (B143).

From a linked worktree it writes the capture and **leaves `INDEX.md` alone**,
saying so. That is deliberate: a worktree's lanes are stale, so the block
regenerated there reinstates rows for tasks that have since moved, and every
branch in flight regenerates the same block and conflicts with the others.
`npm run tasks -- index` in the main checkout after merging is what puts it
right; `--index` forces it here if you really mean it.

| Field | Values | Means |
| --- | --- | --- |
| `type` | SECURITY · ISSUE · FEATURE · CHORE · OPS · DOCS | what kind of thing it is |
| `priority` | high · medium · low | what it costs to leave alone |
| `complexity` | low · medium · high | what it costs to fix |

`priority` and `complexity` are independent and both are needed: B01 is a
one-line fix for the most serious thing on the list, and a single "severity"
field would hide that. `complexity` does one more job now: it is what splits a
FEATURE between `big-feature/` and `small-feature/`, so `high` on a feature is
a claim that this is a fortnight and a design decision rather than an
afternoon.

**Two of the six types are for work that is not a diff**, and reaching for
CHORE instead is what made a lane of nine chores turn out to be three
unrelated jobs:

- **`OPS`** — the deliverable is *doing it against the running instance*:
  enabling a capability and driving it end to end, the restore drill, a
  penetration test. It produces findings and other tasks. If the acceptance
  criterion cannot be met on a laptop, this is the type.
- **`DOCS`** — the deliverable is *words somebody reads*: `AGENTS.md`, a skill,
  `/agent.md`, a doc comment that points at a file which no longer exists, the
  demo content an agent learns the model from. Code may change; what makes it
  DOCS is that the change is to what is understood, not to what runs.

**`superseded:`** is the one field that overrides the type. It carries what
overtook the task — an id, or in a sentence what was found — and files it under
`superseded/`. Use it when a task turns out to be done, wrong, or about code
that no longer exists. It is not `completed/`: nothing here claims a person
verified anything, and the task keeps its file and its id because ids are
forever. Say what overtook it in the body as well, under `## Why`, so the next
reader does not re-derive it.

**The title is the problem, not the fix.** "X-Forwarded-For is taken on trust"
survives being wrong about the remedy; "Add header_up to the Caddyfile" does
not, and quietly decides the solution before anyone has looked.

Then fill in the three sections the template leaves as TODO:

- **Why** — what is wrong or missing, with `file:line` references, and what it
  costs. Enough that somebody in six months does not re-derive the finding.
- **Work** — the intended change. Say what you are *not* doing, where a reader
  would assume otherwise.
- **Acceptance** — how anyone knows it is finished. Concrete: a command, an
  observable behaviour, a test that fails now.

House style of `docs/`: plain prose, the reasoning included, no filler. If the
design needs its own document, write a plan in `docs/plans/` and have the task
point at it — B06 is the example.

### 2. Review — the person's step

The author reads `backlog/` and promotes what they want done:

```bash
npm run tasks -- move B01 open
```

"Add it to the backlog" is not permission to do this; neither is "this looks
important".

### 3. Build it

`work-on-a-task` covers this in full: take from `open/`, commit the lane move,
branch and worktree named for the task, update the task file as you learn,
verify against the four checks and the task's own acceptance criteria, merge,
and land in `testing/`.

```bash
npm run tasks -- move B03 in-development     # stamps started:, takes the hold
npm run tasks -- move B03 testing            # stamps merged:, lets go
```

Move to `in-development` **when you begin**, not when you finish — the lane and
the hold together are how anybody else sees the task is taken. More than two or three at once means
they are not actually in development; move the rest back to `open/`.

### 4. The person tries it

A task in `testing/` has merged and is waiting for somebody to look. Nobody
holds it — the builder let go at the merge — so an agent verifying one claims
it first, and releases if it hands the ticket back:

```bash
npm run tasks -- claim B03
```

When they are satisfied:

```bash
npm run tasks -- move B03 completed
```

Record what shipped it — a commit sha or a branch — in a closing line of the
task. Completed tasks are the record; they are not deleted.

If it does not hold up, it goes back to `in-development/` with a line saying
what was wrong. That is a normal outcome, not a failure of the process.
Whoever moves it there takes the hold, so say in the task whether you are
carrying on with it or leaving it for somebody else — and `release` it if you
are not.

### 5. When the answer is "no"

A task that will not be done is still worth keeping. Move it to `completed/`
and say plainly at the top why it was closed unbuilt. A rejected idea that
leaves no trace gets proposed again in three months.

## Rules that are easy to get wrong

- **Reference other tasks by id in prose** (`see B01`), never by relative
  path. Files move between lanes and a path link breaks when one does.
- **Never hand-edit the tables in `INDEX.md`.** They are generated between the
  `<!-- generated:begin -->` markers; run `npm run tasks`. The prose around
  the markers *is* hand-written and is preserved.
- **Do not move a plan out of `docs/plans/`.** Those are the record of intent
  as written before the work, deliberately not updated to match what shipped.
  When a plan has an unbuilt remainder, open a task pointing at it — W20 →
  B06, W28 → B07, W30 → B08.
- **One task, one problem.** Two findings that share a fix can share a file
  (B02 is headers and inline SVG, because one CSP closes both). Two findings
  that merely share a file should not (B01 and B04 are both `lib/rateLimit.ts`
  and are separate, because their priorities differ by two levels).

## Red flags — stop

- About to write code, and there is no task → capture it first.
- Moving something you captured into `open/` → that is the author's call.
- `open/` is empty, so taking the best-looking thing from `backlog/` → stop
  and ask.
- Moving anything to `completed/` yourself → that gate is a person's, always.
- Reporting a task done when it is in `testing/` → it is merged, not verified.
- Editing an `INDEX.md` table by hand → run the script.
- Writing a capture's markdown yourself and picking the next free number →
  `npm run tasks -- new` is the only thing that can promise nobody else gets it.
- Committing an `INDEX.md` regenerated in a worktree → it is a stale rendering,
  and it is what conflicts on every merge.
- A title that names a solution → rewrite it as the problem.
- `--force` past somebody's hold because it looked stale → the message says how
  long it has stood. Under an hour, assume the agent is alive.
- Verifying a ticket in `testing/` without claiming it → two sibling agents are
  about to do the same work and file contradictory verdicts.
- Writing `session:` or `claimed:` into a file by hand → `move`, `claim` and
  `release` own those two fields.
