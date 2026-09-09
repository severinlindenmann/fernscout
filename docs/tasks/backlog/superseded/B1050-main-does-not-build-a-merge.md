---
id: B1050
title: main does not build: a merge left two features keys in one object literal in helper-proposal-arguments.test.ts
type: ISSUE
priority: high
complexity: low
area: tests,build
found: "2026-09-09T07:08:22Z"
superseded: "Fixed on main by another session while this was being written — the duplicate features key is gone and the comment there now names both merges that added one. Captured and fixed in parallel; the diagnosis in this file still stands as the record of why a duplicate key passed every test and failed only the build."
---

# B1050 — main does not build: a merge left two features keys in one object literal in helper-proposal-arguments.test.ts

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`npm run build` on `main` fails:

```
test/helper-proposal-arguments.test.ts(238,7): error TS1117:
An object literal cannot have multiple properties with the same name.
```

The journal config written in that file's fixture carries `features:` twice,
with two different comments explaining it:

```ts
features: { contacts: { enabled: true } },
features: { auth: { enabled: true }, contacts: { enabled: true } },
```

It arrived in a conflict resolution — the file is one of the `UU` paths in the
merge another session ran around 08:59 on 2026-09-09, the one that landed
`c616728d` and `e77f5455`. Both sides of the conflict had added a `features:`
line and the resolution kept both.

Two things make this worth a high priority rather than a tidy-up. It **blocks
every session**, because `npm run verify` runs the build first and stops there,
so nobody can verify anything on a branch cut from this `main`. And it is
**invisible to the tests**: a duplicate key is legal JavaScript, the last one
wins, so the fixture behaves exactly as intended and every test in the file
passes. Only `tsc` objects, which is precisely why AGENTS.md puts the build
ahead of the typecheck.

Found when `npm run verify` failed in an unrelated worktree (B1039) on a file
that worktree had never touched.

## Work

Keep one `features:` line. The second — `{ auth, contacts }` — is the one that
was actually in effect, so that is the behaviour to preserve; fold the two
comments into one rather than dropping either explanation.

Then check the same merge for the same mistake elsewhere: it had conflicts in
`components/HelperAsk.tsx`, `lib/helper/blocks.ts`, `lib/i18n.ts`, all three
locale files and five test files. A clean `npm run build` clears the whole
class, since TS1117 is reported per file.

## Acceptance

`npm run build` succeeds on `main`, and `npm run verify` gets past its first
step.

