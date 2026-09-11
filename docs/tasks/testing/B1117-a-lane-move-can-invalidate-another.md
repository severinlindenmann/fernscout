---
id: B1117
title: A lane move can invalidate another ticket's acceptance section and nothing notices
type: ISSUE
priority: medium
complexity: low
area: tasks
found: "2026-09-09T17:13:57Z"
started: "2026-09-11T14:52:00Z"
merged: "2026-09-11T15:15:02Z"
---

# B1117 — A lane move can invalidate another ticket's acceptance section and nothing notices

## Why

B103's Acceptance section reads: *"An explicit line for each of B29, B40, B55,
B69 and B98 saying whether this run confirms or contradicts it — those five
are in `testing/` and this is the evidence they are waiting for."*

On 2026-09-09 all five moved to `completed/` in a single bulk lane move, and
B103's acceptance became false the moment they did. Nothing noticed. The
checks it asks for are still worth running; what changed is that a mismatch
found now is no longer "this run contradicts a ticket awaiting verification"
but "a closed ticket's claim does not hold in production", which is a
different filing and a different conversation.

The general shape: **a task file may assert something about another task's
lane, and lanes move.** Nothing in `scripts/tasks.mjs` or
`test/task-ids.test.ts` reads prose, so nothing can catch it. The id test
already checks that every referenced id exists — this is the same class of
check one level deeper.

## Work

Cheapest useful version first: when `npm run tasks -- move` changes a
ticket's lane, grep the other task files for that id and print a line naming
every file that mentions it *and* a lane word. Not a failure, not a block — a
sentence on stdout saying "B29 is mentioned by B103; check whether that
sentence still means what it did." A person or an agent reads it and decides.

Not doing: parsing prose for claims, or refusing a lane move. Both are
guesses; the printed hint is not.

The alternative worth weighing in one line before building: teaching agents to
never write a lane into prose. That is a rule nobody can enforce and this
codebase has already learned twice (B633 → B668) that an unenforceable rule
comes back within a fortnight.

## Built, 2026-09-11

`move()` in `scripts/tasks.mjs` calls a new `noteMentions(item)` after the
rename, once the move is on disk. It rereads every other task file's raw text
(frontmatter and body together — the claim can sit in either) and prints one
line per file that matches `\bID\b` and `\b(backlog|open|in-development|
testing|completed)\b`, both case-insensitive:

```
  note: B29 is mentioned by B103 (completed/B103-….md) — check whether that still holds.
```

Exactly what the ticket asked for: a hint on stdout, nothing parsed, nothing
refused, no file but the one that moved is touched. A ticket that mentions
neither the id nor a lane word prints nothing, so an ordinary move (the
overwhelming majority) is silent.

## Acceptance

- Moving a ticket that another ticket's prose mentions prints one line naming
  the mentioning file.
- Moving a ticket nobody mentions prints nothing.
- `npm run verify` unaffected — this is a hint, not a gate.
