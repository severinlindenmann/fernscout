---
id: B1508
title: A scratch journal named test-something poisons the depersonalised guard with common words
type: ISSUE
priority: medium
complexity: low
area: tests, content
found: "2026-09-11T19:04:39Z"
---

# B1508 — A scratch journal named test-something poisons the depersonalised guard with common words

## Why

Hit live on 2026-09-11. `test/depersonalised.test.ts` went red with five
failures on a `main` that had been green minutes earlier, and the first one read:

```
FAIL  no source file matches /\bTest\b/i
  scripts/verify.mjs:111: const failing = lines.filter((l) => /(FAIL|✗|✕)/.test(l));
```

`.test(l)` is not a personal name. The guard had simply been told it was.

**The mechanism is the guard's own best feature turned against it.** It derives
its forbidden words from whatever `content/` actually holds — its comment
explains why at length, and the reasoning is sound: a hardcoded list *"went
stale the moment somebody was renamed"*, and the file whose job is keeping names
out of the repository was itself where the names were written down.

But another session had just created a scratch journal at
`content/test-b1474-owner/`. That directory name, and whatever owner block it
carries, contributed the words **"Test"** and **"Owner"** to the pattern list —
and those words appear all over `lib/`, `app/` and `scripts/` in perfectly
innocent code. Five failures, none of them a leak.

This is not a one-off. AGENTS.md **instructs** agents to name throwaway journals
`test-<something>`, and `get-a-credential` gives `test-scratch` as its worked
example with `owner: { name: "Test", nickname: "Test" }`. So the documented way
to make a test journal is the thing that breaks this test.

## Work

The guard should not take a term from a journal it can tell is scratch. Two
candidates, and the first is probably enough:

- Skip any journal whose directory name matches the `test-` convention AGENTS.md
  already defines. That convention exists precisely so anybody can tell a test
  journal from a person's; the guard can read it too.
- Refuse to add a term that is too common or too short to be a name —
  a stop-list, or a minimum length. Weaker: "Owner" is neither short nor rare,
  and somebody really could be called Test.

Whichever: when the guard does reject a term, it should say so in its failure
message, because the failure it produced here pointed at `scripts/verify.mjs`
and gave no hint that the cause was a directory somewhere else entirely.

Not in scope: changing how a scratch journal is named. That convention is load
bearing for other reasons (an export, a backup, an `ls`).

## Acceptance

- With a `content/test-*` journal present, `npm run verify` is green.
- Removing a real person's name from `content/` still makes the guard fail,
  so the thing it exists for still works.
- A rejected term is named in the failure message.
