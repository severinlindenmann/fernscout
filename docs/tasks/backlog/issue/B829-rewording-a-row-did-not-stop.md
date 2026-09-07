---
id: B829
title: Rewording a row did not stop the wrong one matching
type: ISSUE
priority: high
complexity: low
area: agent
found: "2026-09-07T15:56:18Z"
---

# B829 — Rewording a row did not stop the wrong one matching

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
