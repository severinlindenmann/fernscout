---
id: B145
title: Task stamps record only a date, and nothing says which agent is on it
type: CHORE
priority: medium
complexity: low
area: tasks, agents, tooling
found: "2026-09-03"
started: "2026-09-03"
---

# B145 — Task stamps record only a date, and nothing says which agent is on it

## Why

Two gaps in the same three lines of `scripts/tasks.mjs`, and one fix reaches
both — the frontmatter a lane move writes.

**A stamp is a date.** `today()` (`scripts/tasks.mjs:52`) yields
`2026-09-03`, and `STAMPS` writes it into `found:`, `started:`, `merged:` and
`completed:`. This repository routinely runs several agents in one afternoon:
B01's `found`, `started` and `merged` are all `"2026-09-01"`, which says the
whole task happened on a Tuesday and nothing more. The ordering of two tasks
taken an hour apart is unrecoverable, and so is the answer to "how long did
that actually sit in testing".

**Nothing records who is holding a task.** The lane is the only signal that a
task is taken, and it is coarse: `in-development/` says *somebody* is on it,
not which session. B143 and B144 are both the same afternoon's parallel run
going wrong. Two agents can each read `in-development/` and each conclude the
other's task is theirs to continue, and the loser finds out at the merge.

`testing/` is worse, because that lane is worked by a *different* agent than
the one that built it — `.claude/skills/test-the-live-site` dispatches one
subagent per ticket, three in flight. Three siblings reading the same lane have
nothing that distinguishes a ticket already being verified from a free one.

## Work

In `scripts/tasks.mjs`:

- Replace `today()` with `now()` — a whole ISO 8601 instant in UTC, to the
  second: `2026-09-03T14:22:10Z`. All four lane stamps and `found:` on `new`.
  Quoting moves into `setField`, because a value containing `:` currently goes
  through `JSON.stringify` and would come out double-quoted.
- Add `session:` — the agent session holding the task now — and `claimed:`,
  the instant it was taken. Value from `--session`, else
  `$CLAUDE_CODE_SESSION_ID`, else nothing: a person running the script by hand
  holds nothing.
- Stamp the pair on `move … in-development`; clear it on every other lane,
  `testing/` included. The agent that merged is done, and the next holder is
  somebody else.
- `claim <id>` / `release <id>`: take and let go **without** a lane move, which
  is the only way a testing agent can say it is on a ticket that must stay in
  `testing/`.
- Refuse `claim` and `move … in-development` when a *different* session already
  holds it, naming the holder and how long it has been held, with `--force` to
  break the lease. A warning an agent can ignore is not a lock.
- Show the holder in `list` and in the generated `INDEX.md` tables — but only
  for the two lanes where a hold means anything.

**Not doing:** no staleness expiry, no automatic lease timeout. A dead
session's hold is broken by a person or by `--force`, deliberately, rather than
by a timer this repository would then have to be right about.

**Not backfilling.** The 130 tasks already on disk keep their date-only stamps.
Widening `"2026-09-01"` to a midnight instant would invent a time nobody
recorded, and the point of the change is provenance.

## Acceptance

- `npm run tasks -- move <id> in-development` writes `started:` as a full
  instant with a time, and a `session:` matching `$CLAUDE_CODE_SESSION_ID`.
- Moving that task on to `testing` clears `session:` and `claimed:`.
- `claim` twice from two different session ids: the second is refused and names
  the first; `--force` takes it.
- `npm run tasks` and `INDEX.md` show the holder for `in-development` and
  `testing`, and no holder column anywhere else.
- Existing date-only stamps still parse and still render; `npm run tasks --
  index` leaves them untouched.
- `test/tasks-script.test.ts` covers the stamp shape, the lease and its refusal.
- `npx tsc --noEmit && npx eslint . && npx vitest run && npm run build`.

## What it turned out to be

Built as written. Three things worth recording, none of which changed the shape:

- **The double-quoting was real.** `setField` quoted a value containing `:`,
  and the caller passed stamps pre-quoted, so the first timestamp came out as
  `merged: "\"2026-09-03T19:07:05Z\""`. Quoting is now `yaml()`'s job alone and
  callers pass the bare value. `test/tasks-holds.test.ts` pins it.
- **`--session` validates.** `--session --force` would otherwise have held the
  task under the session id `"--force"`, and an empty `CLAUDE_CODE_SESSION_ID`
  would have held it under the empty string. Both now read as absent or refuse.
- **The holder column is per-lane.** `table()` emits `Held by` for
  `in-development/` and `testing/` only. Sixty backlog rows of an em-dash is
  the kind of noise that stops people reading a generated table at all.

Docs that had to move with it: `manage-tasks` (a new section on the
frontmatter, and one on the hold), `work-on-a-task` (the move *is* the claim;
do not hold a ticket after it lands in `testing/`), `test-the-live-site` (each
verification subagent claims before it starts — this is the skill the whole
`testing/` half of the design is for), `AGENTS.md` and the prose in
`docs/tasks/INDEX.md`.
