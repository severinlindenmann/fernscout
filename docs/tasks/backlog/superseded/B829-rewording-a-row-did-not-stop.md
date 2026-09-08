---
id: B829
title: Rewording a row did not stop the wrong one matching
type: ISSUE
priority: high
complexity: low
area: agent
found: "2026-09-07T15:56:18Z"
superseded: B900
---

# B829 — Rewording a row did not stop the wrong one matching

## Superseded by B900

This ticket was written against the pre-model router in `lib/helper/intents.ts`
that classified a sentence into one named "row" — a `storage` row and a
`write_day` row among them — with only that row's own English `describe`
string to go on, and nothing else about the conversation. B900 ("a proposal
can be accepted, corrected, or left alone", commit `51aaea86`, merged
2026-09-08T06:03) deleted that router outright. Every sentence that survives
the deterministic refusal table (`lib/helper/intents.ts::refusalFor`, B817)
now goes straight to `answerInThread` in `lib/helper/model.ts`, which hands
the model the **whole tool registry** (`lib/helper/tools.ts`) as real
function-calling schemas (`toolSchemas()`) inside the ongoing conversation —
the same "code guard, not a reworded prompt" shape this ticket's own finding
argued for, just built one level up: the model chooses a tool with the full
conversation in view and can ask a clarifying question, rather than a
separate classifier picking one row off a sentence in isolation.

Verified 2026-09-08, in this checkout:

- There is no `storage` row and no `write_day` row any more. The nearest
  equivalents are `lib/helper/tools.ts` tools named `account` (credits +
  disk, merged into one read since nobody asks one without the other) and
  `start_day` (proposes an empty day).
- **Both of this ticket's two "Work" asks are already in the tool
  descriptions that `51aaea86` introduced** — before this session touched
  anything:
  - `account`'s `describe` (`lib/helper/tools.ts:548`): *"This journal's own
    account: credits left, and disk space used out of what it may. … Bytes
    only — never where anything is."* — narrower than B808's own attempt
    ("never where a photograph, a day or a file has got to"), and phrased as
    a flat negative rather than an example list.
  - `start_day`'s `describe` (`lib/helper/tools.ts:759`): *"Propose starting a
    day of a trip — an empty day with a date, ready for words and
    photographs."* — photographs are named, which is exactly what B808 said
    the `write_day` row's description never did.
  `git log -S"ready for words and photographs" -- lib/helper/tools.ts` and
  `git log -S"Bytes only" -- lib/helper/tools.ts` both point at the single
  commit that created the file, `51aaea86` — these were not bolted on after
  the fact, they are what the rewrite shipped with.
- `grep -rn "confidence" lib/ app/` (already run for B730, re-run here) finds
  nothing left to route on. B730, the sibling ticket about the confidence
  floor this one's Acceptance depended on ("B730 is still open on the
  confidence floor"), was independently closed the same way today, citing the
  same commit.
- No test in `test/helper-tools.test.ts` or elsewhere locks in wording for
  `account` or `start_day`, so nothing here was pinned against the old
  behaviour either.

What is **not** verified, because the mechanism the ticket asked to retest no
longer exists and this session has no live-model or live-site credential: an
end-to-end run of "wheres my stuff" / "put my photos up" against the deployed
helper under the new tool-calling architecture. That is a legitimate
follow-up but a different question than this ticket asked — it would be
testing real function-calling with full conversational context, not a row
description in isolation — so it is filed separately rather than reopening
this one. See the new capture below.

No code changed. Only this file and its metadata.

## Why

B808 tried to stop "wheres my stuff" matching the `storage` row by making the
row's description narrower — "Bytes on disk only — never where a photograph, a
day or a file has got to."

Retested against the live instance immediately after deploying, 2026-09-07:

```
wheres my stuff      -> storage | "This journal holds 104 MB of its 5.0 GB…"
put my photos up     -> unknown
whats my trip called -> what_is_my_trip ✓   (this half worked)
take down the day…   -> refuse_remove   ✓   (this half worked)
```

**The description change did not move the model.** That is the finding, and it
is worth more than the bug: prompt wording is not a reliable lever for this
kind of collision, and the two fixes in the same ticket that used *code* — a
pre-router refusal table, and a new registry row — both worked first time.

"put my photos up" also still falls through to `unknown`, though B808 said it
should reach `write_day`. Nobody added the phrasing; the row's description
never mentions photographs at all.

## Work

Stop trying to fix this with adjectives.

- For `storage`: decide in code. A sentence with no disk-space vocabulary in it
  ("stuff", "things", "photos", "where") should not be answerable by a row
  about megabytes — either a guard like the refusal table, or a clarifying
  answer that offers both readings and lets the person pick.
- For `write_day`: say in its description that it covers putting photographs up,
  which is what most people call it.
- Then **retest both against the live model**, because a description change that
  is not measured is a change that has not happened. This ticket exists because
  one was assumed.

B730 is still open on the confidence floor; feed this in as further evidence
that the floor is not the lever either.

## Acceptance

"Where's my stuff" does not answer with megabytes, and "put my photos up"
opens the wizard — both verified against the live model, not against a stub.
