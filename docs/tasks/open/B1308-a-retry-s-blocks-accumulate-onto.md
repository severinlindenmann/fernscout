---
id: B1308
title: A retry's blocks accumulate onto the first, wrong attempt's own blocks
type: ISSUE
priority: medium
complexity: medium
area: helper, honesty
found: "2026-09-10T12:15:45Z"
---

# B1308 — A retry's blocks accumulate onto the first, wrong attempt's own blocks

## Why

Found investigating B1304's scenario-costs.md defect F: a `start_day`
proposal for 2026-09-11 arrived with a stale, unrelated block glued in front
of it — `agent.block.day` ("Der Tag, wie er ist") naming 2026-09-10, plus the
`agent.noScreenHere` honesty-guard fallback (B1237's `claimsAChatScreen`
check retried and still failed).

`lib/helper/model.ts` declares `const blocks: Block[] = []` once per
`answerInThread` call (~line 1614) and `rounds()` pushes onto it as tools are
called. When a first attempt trips an honesty guard, the retry calls
`rounds()` a **second time** (~line 2009: `answer = withoutMarkers(await
rounds())`) — but `blocks` is never cleared before that second call. Whatever
the first, *wrong* attempt drew (a stale preview from an earlier tool call,
say) survives untouched into the final result, sitting beside whatever the
retry itself draws. The final `answer` text is corrected (or replaced with
`PLAINLY[...]` on a second failure); the blocks never are.

## Work

Not designed here — see B1304's own "Investigation" section for why a
blanket `blocks.length = 0` before every retry is not obviously safe.
Several `RETRY` shapes (`day`, `total`) deliberately want the model to call
a read tool again on retry, and the block that call draws is exactly the
wanted output; other shapes (a false "claim" with a proposal genuinely still
pending) may need the *first* attempt's proposal block kept, since the model
may not re-propose it on a retry that only corrects wording.

A next step: trace, for each of the dozen `RETRY`/`PLAINLY` shapes, whether
the first attempt's blocks should survive a retry, be discarded, or be kept
only if the retry's own round drew nothing of the same kind — then implement
per-shape rather than one blanket rule, with a test per shape that currently
has no coverage for "did the first attempt's stale block survive."

## Acceptance

A live or scripted turn that trips an honesty guard and calls a *different*
tool on its first (wrong) attempt than the retry does must not carry the
first attempt's block into the final result — reproduce scenario-costs.md's
defect F as a test first (a `read_day`-drawing first attempt, a
`claimsAChatScreen` retry that fails, and assert the day-preview block for
the wrong date is absent from the final blocks/messages).
