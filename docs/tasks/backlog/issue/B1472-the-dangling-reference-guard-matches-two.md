---
id: B1472
title: The dangling-reference guard matches two and three digit ids, and every id since B1000 has four
type: ISSUE
priority: high
complexity: low
area: tasks, tests
found: "2026-09-11T15:19:49Z"
---

# B1472 — The dangling-reference guard matches two and three digit ids, and every id since B1000 has four

## Why

Found by B1052's sweep, which flagged it in passing as "a possible separate
small capture". It is not small.

`test/task-ids.test.ts:161`:

```js
for (const [reference] of task.body.matchAll(/\bB\d{2,3}\b/g)) {
```

Two or three digits. Every id allocated since B1000 has four, and the trailing
`\b` means a four-digit id does not even match as its first three characters —
`"see B1471".match(/\bB\d{2,3}\b/g)` is `null`, checked.

**471 of the 1,430 task files carry a four-digit id.** So the guard that stops a
ticket referring to an id that does not exist is blind to a third of the
tickets, and to *all* current work — it has been silently dead for the entire
recent history of this repository, passing green the whole time.

That is the shape of failure this codebase treats as worse than no guard at all:
`npm run verify` has been reporting a check that was not running.

The immediate consequence was visible in the same sweep. Two ids were cited in
shipped code with no task file — **B1051** in ten places and **B431** in four.
The guard caught `B431` the moment it appeared in prose, because it is three
digits. It would never have caught `B1051`.

## Work

Widen the pattern to the ids actually in use, and make it hard to outgrow again:
`\bB\d{2,5}\b` costs nothing and survives the next thousand.

Then run it against the whole tree and see what it finds, because **it has never
run against 471 files**. Expect real dangling references. Fix them or capture
them; do not widen the pattern and leave a red suite for somebody else.

Consider whether the same pattern is duplicated elsewhere — `grep -rn 'B\\d{' test/ scripts/` — since a second copy would have the same blind spot and one of them will be missed.

Not in scope: checking code comments as well as task bodies. B1052 asked and
answered that, and the answer was no.

## Acceptance

- The guard matches a four-digit id, proven by a test that would fail on the old
  pattern.
- It runs clean across all 1,430 task files, or every surviving dangling
  reference has been captured with an id.
- `npm run verify` clean.
