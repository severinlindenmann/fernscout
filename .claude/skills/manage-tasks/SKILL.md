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
  completed/         shipped, kept as the record
```

```bash
npm run tasks                          # what is in each lane
npm run tasks -- move B03 completed
```

## The two rules

**1. Anything you notice goes in `backlog/`.** Not `open/`. `new` writes there
and that is the only lane an agent adds to.

**2. Only a person moves a task from `backlog/` to `open/`.** `open/` is the
reviewed queue — the tasks the author has read and agreed are worth doing. It
is what makes "find yourself something useful" a safe instruction: an agent
picking its own work takes it from `open/`, never from `backlog/`.

Promoting your own capture to `open/` and then starting it is the failure this
skill exists to prevent. It converts "I noticed something" into "I decided
this project needs it", and skips the one review step in the loop.

If `open/` is empty and you were asked to pick something up: **say so and
stop.** Show what is in `backlog/` and ask which to promote. Do not promote,
do not pick the highest-priority backlog item, do not start "the obvious one".

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

| Field | Values | Means |
| --- | --- | --- |
| `type` | SECURITY · ISSUE · FEATURE · CHORE | what kind of thing it is |
| `priority` | high · medium · low | what it costs to leave alone |
| `complexity` | low · medium · high | what it costs to fix |

`priority` and `complexity` are independent and both are needed: B01 is a
one-line fix for the most serious thing on the list, and a single "severity"
field would hide that.

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

An agent runs this only when told to, in that turn, for that id. "Add it to
the backlog" is not permission; neither is "this looks important".

### 3. Take one on

```bash
npm run tasks -- move B03 in-development
```

Stamps `started:`. Move it **when you begin**, not when you finish — the lane
is how anybody else sees the task is taken. More than two or three in
`in-development` at once means they are not actually in development; move the
rest back to `open/`.

Asked to pick something up with no id given: take the highest-priority task in
`open/`, say which you took and why, and start. Ties break toward lower
`complexity` — finishing something beats starting something.

### 4. Finish

Before anything moves to `completed/`, the bar from `AGENTS.md` applies — all
four, every time:

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
```

Then check the task's own **Acceptance** section line by line. If a line
cannot be demonstrated, it is not finished: say which line, and leave it in
`in-development/`.

```bash
npm run tasks -- move B03 completed
```

Record what shipped it — a commit sha or a branch — in a closing line of the
task. Completed tasks are the record; they are not deleted.

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
- Moving to `completed/` without having run the four checks → not finished.
- Editing an `INDEX.md` table by hand → run the script.
- A title that names a solution → rewrite it as the problem.
