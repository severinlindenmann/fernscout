---
id: B730
title: The router confidence floor is a guess with nothing to tune it against
type: ISSUE
priority: low
complexity: low
area: agent
found: "2026-09-07T12:16:40Z"
started: "2026-09-08T21:12:03Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:12:03Z"
superseded: B900
---

# B730 — The router confidence floor is a guess with nothing to tune it against

## Superseded by B900

This ticket complained about `app/api/helper/[user]/ask/route.ts:44`, where a
pre-model router (`lib/helper/intents.ts`) classified a sentence into a row and
treated anything under 0.5 confidence as `unknown`. B900 ("proposals that can
be accepted and corrected in words") deleted that whole router: every sentence
that survives the deterministic refusal table now goes straight to
`answerInThread` with the full tool registry (`lib/helper/tools.ts`) in front
of it — there is no classification step and no confidence score left
anywhere.

Verified 2026-09-08, in this checkout:
- `app/api/helper/[user]/ask/route.ts` is 300 lines with no `confidence`
  threshold or `unknown` branch; the one `confidence: 1` in the file is a
  fixed value on a hard-coded refusal reply, not a router output.
- `lib/helper/intents.ts`'s own doc comment says outright: "There was a router
  in front of this: a model that classified the sentence into a row of
  `lib/helper/intents.ts` … The rows are gone; every sentence that is not
  refused goes to `answerInThread` with the whole registry
  (`lib/helper/tools.ts`) in front of it." What is left in that file is only
  the deterministic, pre-model refusal table (B817), matched on the raw
  sentence and never a confidence fallback.
- `grep -rn "confidence"` across `lib/` and `app/` turns up nothing else.

There is nothing left to tune. No code changed beyond this file and the task
metadata.

## Why

`app/api/helper/[user]/ask/route.ts:44` treats anything under 0.5 confidence as
`unknown`. The number is a guess, made with no traffic to tune it against, and
it decides how often the box says "I am not sure" versus opening a wrong screen
— which is the whole feel of the feature.

Too high and the box is useless; too low and it confidently opens the wrong
thing, which the confirm panel catches but which still wastes the tap.

## Work

Not a code change yet. Log what confidence real asks come back with, and what
the person did next, before moving the number. Then move it once, with the
measurement written into the file beside it.

## Acceptance

The floor is a number somebody measured, and the file says what the measurement
was.
