---
id: B100
title: The documented verification order runs tsc before the build that generates the types it needs
type: CHORE
priority: low
complexity: low
area: docs, tooling
found: "2026-09-03"
started: "2026-09-04T05:58:30Z"
merged: "2026-09-04T06:22:16Z"
---

# B100 — The documented verification order runs `tsc` before the build that generates the types it needs

## Why

`AGENTS.md`, under *Verifying a change*, lists the four checks in this order:

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```

*"All four, every time."* The order is wrong for anybody who has added a route.

Next generates typed-route definitions into `.next/types` at build time, and
`PageProps<"/[user]/…">` and `AppRouteHandlerRoutes` resolve against them. On a
checkout where the build has not run since the route appeared, `tsc --noEmit`
reports the new page as a type that "does not satisfy the constraint
`AppRoutes`", plus a cascade of `Property 'user' does not exist on type
'unknown'` for its params. The code is fine. The types have not been generated.

Observed twice in one afternoon, both times costing real time:

- On `main` immediately after merging B33, `npx tsc --noEmit` produced 13 errors
  across the four new invite routes; `npm run build` then `npx tsc --noEmit`
  produced none, with no source change in between.
- In a fresh worktree after `npm ci`, B79's agent reported roughly sixty
  phantom `Cannot find name 'PageProps'` errors until `next build` had run once.

An agent following the documented order on a fresh worktree meets a wall of type
errors as the very first thing it does, in files it did not write. The honest
readings available to it are "the merge is broken" or "the documentation is
wrong", and one of those leads to unpicking work that was fine.

There is a second, quieter cost: a *real* type error is now indistinguishable
from this noise on a cold checkout, which is exactly when somebody is least able
to tell the difference.

## Work

The smallest correct change is to the documentation, and it is probably the
whole task. Candidates:

- **Reorder**: put `npm run build` first, or pair it with `tsc` as one step.
  Cheapest, and honest about the dependency.
- **Say why**: keep the order and add one sentence — the build generates route
  types, so run it first on a cold checkout. Preserves the current habit for
  people whose `.next` is warm.
- **Make it one command**: an `npm run verify` script that runs the four in a
  working order, so the sequence lives in one place rather than in prose that
  each reader re-types. Then `AGENTS.md` names the script. Attractive, but check
  first whether anything already depends on the four being separate — a failing
  step should still be identifiable at a glance.

Whichever ships, the same wording has to reach the places that repeat the list,
or this becomes the documentation problem `AGENTS.md` already warns about — *a
reference kept in two files is a reference that disagrees with itself within a
month*. Check `.claude/skills/work-on-a-task/SKILL.md`, which repeats all four,
and grep for the others.

Not doing: changing what the checks are, adding a check, or touching the Next
config. `.next/types` is generated output and stays gitignored — committing it
would trade a confusing failure for a stale one.

## Acceptance

- From a clean checkout with no `.next` (`rm -rf .next`), following the verify
  instructions in `AGENTS.md` top to bottom produces no failure that a source
  change did not cause — demonstrated on a branch that adds a route.
- Every copy of the four-command list agrees: `grep -rn "tsc --noEmit" AGENTS.md
  docs/ .claude/skills/` shows one order, not two.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

---

## Resolution — 2026-09-04

Reproduced first, on this task's own worktree — freshly created, `npm ci` run,
no `.next`:

```
$ npx tsc --noEmit | wc -l
60
app/[user]/(trip)/costs/page.tsx(14,4): error TS2304: Cannot find name 'PageProps'.
app/[user]/layout.tsx(23,4): error TS2304: Cannot find name 'LayoutProps'.
app/[user]/join/route.ts(21,55): error TS2304: Cannot find name 'RouteContext'.
…
```

Sixty errors, no source change, in files this task never opened. After one
`npm run build`: none.

**Documentation only, and the reorder — build first, with one sentence saying
why.** `.github/workflows/ci.yml:44` already builds before it typechecks and
already carries the comment explaining that `tsc` needs `.next/types`; the
prose was simply the last place that had not caught up. Every copy now reads:

```bash
npm run build          # first — it writes .next/types, which tsc reads
npx tsc --noEmit
npx eslint .
npx vitest run
```

Updated in all six places that repeat the list: `AGENTS.md` §Verifying a
change, `CONTRIBUTING.md` §Before you open a PR, `README.md` §Commands,
`docs/running-locally.md` §Checking a change before you push,
`.claude/skills/deploy/SKILL.md` and `.claude/skills/work-on-a-task/SKILL.md`.
The README's row also said `npm test` where every other copy said
`npx vitest run`; it now agrees.

`docs/running-locally.md` had framed the old sequence as "the order that fails
fastest", which was the honest reason for it. That reason is kept rather than
deleted — the new text says the build is the expensive one, says why it still
goes first, and says that once `.next` is warm you may put `tsc` back in front
if you prefer the faster failure.

**Not doing: `npm run verify`.** The task lists it as attractive and asks that
anything already depending on the four being separate be checked first.
Something does: CI runs `lint`, `typecheck`, `test` and `build` as four
independent jobs, deliberately, so a red badge names the step. A `verify`
script would be a fifth statement of the sequence that CI does not use, and
`AGENTS.md`'s own warning about a reference kept in two files applies to it.
The prose now agrees in six places and the seventh — CI — was already correct.

## Acceptance — met

- From a clean checkout with no `.next`, following `AGENTS.md` top to bottom
  produces no failure a source change did not cause: `npm run build` succeeds
  first, and `npx tsc --noEmit` is then clean. Demonstrated on this branch,
  which is a fresh worktree.
- Every copy agrees:

  ```
  $ grep -rn "tsc --noEmit" AGENTS.md CONTRIBUTING.md README.md docs/*.md \
      .claude/skills/ .github/workflows/ci.yml
  ```

  shows one order — `npm run build` before `npx tsc --noEmit` — in all seven.
  (`docs/plans/` and `docs/tasks/` also match the grep and are deliberately
  left alone: plans are the record of intent as written, and a completed
  task's verification note is what that agent actually ran.)
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
