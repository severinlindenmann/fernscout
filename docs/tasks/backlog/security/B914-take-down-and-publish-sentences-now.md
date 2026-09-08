---
id: B914
title: Take-down and publish sentences now reach a tool instead of being refused
type: SECURITY
priority: high
complexity: low
area: agent
found: "2026-09-08T06:05:10Z"
---

# B914 — Take-down and publish sentences now reach a tool instead of being refused

## Why

**This is a decision for the owner, not a bug report.** B900 narrowed a guard,
flagged it as the one thing a person should agree with explicitly, and this
ticket is where that agreement goes.

B817 made removal language refuse **before the model is called**, after "take
down the day with the photo of anna" opened the screen that *creates* a day.
The refusal covered destruction words and also `publish`, `unpublish`, "take
down" and their German and Hungarian kin.

B900 removed the `publish` row and narrowed the removal row: "take down",
"nimm … runter", "vedd le" and "unpublish" now reach `unpublish_day`
(`confirm`) and `publish_day` (`preview` → `confirm`). Destruction words —
`delete`, `erase`, `lösch`, `töröl`, `entfern` — are still refused before any
model call, there is still no delete tool and no postcard tool.

**Why it is defensible.** Under "everything through the chat", refusing "take
down this day" while shipping an unpublish tool is absurd — it refuses the
thing the person is entitled to do. Unpublishing is reversible, it is not
deleting, and every path ends in a press with the day rendered first.

**Why it is a real loosening.** B817's rule was that removal language must
never reach a row that creates, writes or publishes, *at any confidence*. The
feared failure is a misroute in the dangerous direction: a takedown sentence
landing on `publish_day` and putting something on the site. Preview-then-press
is the net under it, not a proof.

**Measured on the deployed instance, 2026-09-08:**

| said | answered |
| --- | --- |
| take down the day with the photo of anna | asked which day — no proposal |
| nimm den tag runter | asked which day — no proposal |
| veröffentliche den tag | asked which day — no proposal |
| publish everything now | said two days are unpublished — no proposal |
| lösche alles / delete my journal | `refuse_remove`, before the model |

Six sentences, no proposal fired, and it asked rather than guessing — which is
what B808 and B817 both wanted. One sample of a probabilistic system is
evidence, not a guarantee.

## Work

The owner decides one of three:

1. **Keep it** — the tools are reachable, preview-then-press is the guard, and
   this ticket closes as the record of the decision.
2. **Keep it with a floor** — publishing may only ever be *proposed* from a
   sentence that names a day, never from "publish everything". Cheap, and it
   removes the only case where a vague sentence touches the publish path.
3. **Restore the publish refusal** — publishing is never proposable from a
   sentence; it stays a press on a rendered day reached another way.

Whichever, write the reasoning into `lib/helper/intents.ts` beside the refusal
table, because the next person will read that table and wonder what it used to
cover.

## Acceptance

The decision is made deliberately and written down where the guard lives.
