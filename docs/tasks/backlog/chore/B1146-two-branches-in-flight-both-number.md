---
id: B1146
title: Two branches in flight both number their migration 028, so the second to merge has two
type: CHORE
priority: high
complexity: low
area: db, migrations
found: "2026-09-09T18:36:53Z"
---

# B1146 — Two branches in flight both number their migration 028, so the second to merge has two

## Why

The phone group merged `lib/db/migrations/028-signup-phone.ts`. A sibling
session in flight (a worktree, unmerged as of 2026-09-09) carries
`028-journal-registry.ts`. Both are numbered 028.

Git will not catch this: the two filenames differ, so both branches merge
cleanly with no conflict, and the result is two migration files sharing a
number. `lib/db/migrations/index.ts` lists migrations in order, and a
duplicated ordinal is either a runtime error when the second is applied or,
worse, a silently skipped migration — the schema the second one was meant to
create never exists, and every reader of it fails at runtime rather than at
build.

This is the migration analogue of the task-id collision AGENTS.md already
guards against with `nextId()` reserving a number in the shared git dir: two
sessions branching from one commit both reach for the next free number and
both pick the same one. Migrations have no `nextId()`.

Found while merging the phone group; `main` currently has only 028-signup-
phone, so it is not broken yet — the collision lands when the sibling branch
merges.

## Work

Immediate: whichever branch merges second renumbers its migration to the next
free ordinal and updates `index.ts`. That is a person's or that session's
call, not something to fix on `main` pre-emptively.

Durable, and the real point: migrations need the same collision-proofing task
ids already have. Options for a person to choose:

- a test that fails when two files share an ordinal (cheapest; catches it at
  `verify` rather than at runtime, the same way `test/task-ids.test.ts`
  catches duplicate task ids);
- a `npm run db -- new-migration` that reserves the next ordinal in the shared
  git dir the way `nextId()` does;
- content-hash or timestamp ordinals instead of a hand-picked sequence.

## Acceptance

- `main` never carries two migrations with the same ordinal, and something
  mechanical says so rather than a person noticing.
- The immediate collision (028-signup-phone vs 028-journal-registry) is
  resolved by whichever lands second.
