---
id: B1449
title: The thread prompt is 21 tokens from its ceiling, and the ceiling measures a different string than the wire
type: CHORE
priority: medium
complexity: low
area: helper prompt
found: "2026-09-11T11:45:30Z"
---

# B1449 — The thread prompt is 21 tokens from its ceiling, and the ceiling measures a different string than the wire

## Why

Two separate facts, found while measuring the thread's prefix for B1450.

**The ceiling is all but met.** `test/helper-thread.test.ts` asserts the prompt
and tool list stay under 8,000 tokens. The current value is **7,979**. The next
tool `describe` string, or one more sentence in the prompt, breaks the build —
and the failure lands on whoever adds the tool rather than on whoever spent the
budget. The ceiling has been raised five times already; the test's own comment
asks for a paragraph justifying each raise, which is right, but nobody can plan
against a number they only discover by tripping it.

**The metric is not what goes on the wire.** The test measures
`JSON.stringify(tool.properties) + tool.describe`. `toolSchemas()` sends names,
`input_schema` wrappers and `required` arrays too. Measured:

| | tokens |
| --- | --- |
| ceiling test's metric | 7,979 |
| system prompt, on the wire | 3,461 |
| tool schemas, on the wire | 6,086 |
| **what is actually sent** | **9,547** |

So the guarded number is ~17% below the real one, and the gap grows with every
tool added, because the unmeasured part is per-tool boilerplate. A budget that
tracks a proxy rather than the thing is a budget that drifts.

This is not urgent for cost any more — B1450 caches the prefix — but the
ceiling exists for the model's attention, not for the bill, and that argument is
unaffected by caching.

## Work

- Have the test measure `JSON.stringify(toolSchemas())` plus the system prompt,
  which is what `rounds()` sends.
- Re-set the ceiling from the new baseline with real headroom, and say in the
  comment what the headroom is for.
- Report the number on success, not only on failure, so the budget is visible
  without breaking the build to see it.
- Not in scope: cutting the prompt or any `describe` string. Nothing here says
  the content is wrong — only that the gauge reads low and the tank looks full.

## Acceptance

- The test's metric equals the wire prefix within rounding.
- `npm run verify` green, with the new ceiling and stated headroom.

## Related

Do this before B1049 or B1238, both of which add to the prompt. This ticket's
whole point is that the tracked budget measures a different string than the one
that goes over the wire and sits 21 tokens from its ceiling, so either of those
would break the build on a limit nobody would think to look at, for a reason
that has nothing to do with the change being made.
