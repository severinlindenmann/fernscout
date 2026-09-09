---
id: B1071
title: The helper prompt is 7617 tokens against its 6500 ceiling, so main's test suite is red
type: ISSUE
priority: high
complexity: medium
area: helper, prompt
found: "2026-09-09T07:12:49Z"
superseded: "B1053 — the tool list outgrew its budget; the fix is grouping, not a raise. Another session reached the same 7617-against-6500 finding and resolved it the way this ticket argued for, by trimming rather than raising the ceiling."
---

# B1071 — The helper prompt is 7617 tokens against its 6500 ceiling, so main's test suite is red

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`npx vitest run test/helper-thread.test.ts` on `main`:

```
FAIL  what a turn costs > the prompt and the tool list stay under forty-one
      hundred tokens
AssertionError: The prompt and tool list are ~7617 tokens against a ceiling
of 6500 ... expected 7617 to be less than 6500
```

That is 17% over. It arrived with the eleven helper tools merged on
2026-09-09 — `c616728d` (postcard_recipients, postcard_texts,
propose_postcards, photobook, print_order) and `e77f5455` (journal_settings,
cleanup, buy_room, keys, revoke_key, buy_credits, past_conversations). Each
tool's schema and `describe` text is in the prompt on every single turn.

This is the constraint AGENTS.md singles out as the scarce one: *"The prompt
is also the scarcer resource — four separate fixes ran into its token ceiling,
and each time the answer was a guard rather than more words."* The ceiling is
not a lint rule, it is what stops every conversation getting more expensive
and the model's attention getting thinner, on a feature that bills real
credits per turn.

`main` is red because of it, so nothing can be verified on a branch cut from
`main` until it is resolved.

Not the same fault as B1050, which was a duplicate object key in a fixture
from the same merge. That one is fixed; this one is a design question and is
deliberately left to whoever added the tools.

## Work

The test itself says what the options are, and the order to consider them in:
*"is the same thing said here and again in an honesty retry, a tool's
`describe`, or a refusal in `lib/helper/intents.ts`? The prompt states the
rule; the retry makes the case."* So look for the same rule stated twice
before assuming the tools are simply too many.

If trimming will not reach 6500, raising the ceiling is explicitly allowed —
but the test requires it be **its own commit, with a paragraph above the test
saying what the tokens bought**. Do not raise it in the same commit as
anything else, and do not raise it silently.

Worth asking as part of this: whether every tool needs to be in the prompt on
every turn, or whether the printed-things tools could be described only once a
conversation has gone anywhere near a postcard. That is a larger change and
should be its own ticket if it looks right.

## Acceptance

`npx vitest run test/helper-thread.test.ts` passes on `main`, and if the
ceiling moved, the commit that moved it says what the extra tokens bought.

