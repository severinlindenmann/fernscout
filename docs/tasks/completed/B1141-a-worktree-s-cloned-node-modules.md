---
id: B1141
title: A worktree's cloned node_modules goes stale when main adds a dependency, and the build fails as if the change were wrong
type: DOCS
priority: medium
complexity: low
area: worktrees, agents
found: "2026-09-09T18:36:00Z"
started: "2026-09-11T14:51:58Z"
merged: "2026-09-11T15:19:27Z"
completed: "2026-09-11T19:13:17Z"
---

# B1141 — A worktree's cloned node_modules goes stale when main adds a dependency, and the build fails as if the change were wrong

## Why

`AGENTS.md` says to clone `node_modules` into a new worktree with `cp -Rc`, and
says clearly why not a symlink. It says nothing about what happens **after**,
and the gap costs a round of debugging every time a stale branch is picked up.

The clone is a point-in-time copy. Merge `main` into a branch cut a week ago and
the lockfile advances while the copy does not, so the build dies with

```
Module not found: Can't resolve 'tz-lookup'
```

on `lib/timezone.ts` — a file the change never touched, from a feature the
change has nothing to do with. Three separate sessions hit exactly this on
2026-09-09 while catching up B1035, B1039 and B879 (`tz-lookup` had arrived on
`main` with the B1057/B1058/B1064/B1065 group), and each spent a stretch reading
it as a broken merge before landing on the real cause.

It is the same shape as the `.next/types` trap `AGENTS.md` already documents at
length: **the honest readings available to the agent are "the merge is broken"
or "the documentation is wrong", and neither is true.** That trap got a
paragraph because it wastes an afternoon; this one wastes a round for the same
reason and has none.

## Work

One paragraph in `AGENTS.md`, beside the existing `cp -Rc` bullet under "Where
the work happens":

- After `git merge main` in a worktree, re-clone `node_modules` if the lockfile
  moved. `git diff --stat <before>..HEAD -- package-lock.json` is the check, and
  re-running `cp -Rc` is the fix.
- Name the symptom, not just the rule — a module-not-found for a package the
  change never mentions, in a file it never opened, means a stale clone and not
  a bad merge. That sentence is what a searching agent will actually match on.

Worth a look while there: `work-on-a-task` step 2 hands over the worktree recipe
and has the same omission, and it is the document an agent taking a stale ticket
reads first.

Not doing: automating it. A `postmerge` hook or a wrapper script is a mechanism
to maintain for a thing that a sentence prevents, and the repository is
deliberately free of harness requirements a fresh clone would not have.

## Acceptance

`AGENTS.md` names the failure by its symptom, so that grepping the message a
person or agent actually sees finds the answer. An agent handed a two-week-old
branch merges `main`, hits nothing, or hits this and recognises it from the
document rather than from bisecting the build.

## Done

`AGENTS.md`, "Where the work happens", gained a bullet beside `cp -Rc` naming
the symptom (`Module not found` for a package the change never touched, from
a lockfile that moved) and the fix (`git diff --stat` on `package-lock.json`,
then re-run `cp -Rc`). `.claude/skills/work-on-a-task/SKILL.md` step 2 got the
same paragraph beside its own `cp -Rc` recipe, since it is the document an
agent taking a stale ticket reads first.

Also corrected the stale timing claim in the same section of `AGENTS.md`
("the full suite is fifty seconds and the build seventy") — measured in this
checkout: `npx vitest run` alone is ~262s across 525 files, `npm run build`
is ~33s, so the sentence now says "well over four minutes" for the suite and
"under a minute" for the build, with a full `npm run verify` "closer to
five" (lint and knip add the rest). Timed with `time npm run build` and
`time npx vitest run`.
