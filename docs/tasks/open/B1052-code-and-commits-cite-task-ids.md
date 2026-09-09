---
id: B1052
title: Code and commits cite task ids that have no file, so the allocator hands them out again
type: CHORE
priority: low
complexity: low
area: tasks, ids
found: "2026-09-09T07:11:24Z"
---

# B1052 — Code and commits cite task ids that have no file, so the allocator hands them out again

## Why

`app/api/helper/[user]/channels/route.ts:8` opens with *"The `channels` press —
B1051."* Commit `e722ee52` is titled *"B1051: invites, revoke_invite,
tell_readers and channels for the helper."* There is no `B1051` file anywhere
in `docs/tasks/`, and `git log --diff-filter=A -- "docs/tasks/**/B1051*"`
returns nothing — the file was never committed.

That is not merely untidy. `nextId()` allocates from what it can see, so on
2026-09-09 it offered **B1051** to a session capturing something unrelated. Had
that been taken, the code comment and the commit message would both have
pointed at a task about a different subject, permanently and with nothing
failing. AGENTS.md's own warning — *"a duplicate is permanent: two files
claiming one id have different filenames, merge cleanly, and render as two
happy rows"* — describes the near miss exactly.

The number is burnt now (the allocator reserved it in
`.git/fernscout-task-ids` before the file was removed, so the next `new` gave
B1052). What is left is the citation with nothing behind it, and the question
of how many more there are.

## Work

- Sweep for the general case: every `B<number>` cited in `lib/`, `app/`,
  `components/`, `scripts/`, `test/` and in commit subjects, against the ids
  that actually have files. Report the orphans; do not mass-edit.
- For B1051 specifically, a person decides between two endings: write the file
  it should always have had (the work is merged and would land in
  `completed/`), or correct the two citations to name the task that really
  covers that work.
- Consider whether `test/task-ids.test.ts` should read code comments as well
  as task files. Probably not — a stale comment is a one-line cost and a test
  that fails on prose is a test people learn to route around — but the ticket
  should say so rather than leave it unexamined.

Not doing: changing how ids are allocated. The allocator behaved correctly;
what failed was a file that was never committed.

## Acceptance

A list of every orphaned citation, and B1051 either has a file or is no longer
cited by one.
