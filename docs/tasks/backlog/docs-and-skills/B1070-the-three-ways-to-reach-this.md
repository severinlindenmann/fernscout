---
id: B1070
title: The three ways to reach this journal are not written down anywhere as three ways
type: DOCS
priority: high
complexity: medium
area: agent docs, byoa
found: "2026-09-09T07:11:58Z"
---

# B1070 — The three ways to reach this journal are not written down anywhere as three ways

## Why

There are four ways to write a journal on this instance and no page says so:

1. **The helper at `/agent`** — this instance's model, this instance's
   transcription, the journal's credits.
2. **Your own agent, against `/openapi.json`** — it decides, it pays for its
   own model, it uses the same REST doors.
3. **Your own agent on your own machine, against the files** —
   `fernscout-helper`, MIT, `docs/helper.md`, and `/content-model.json` as the
   published file shape.
4. **A messenger**, once B1057 lands.

`/documentation.txt` indexes the instance, `/agent.md` is the fifty-six
kilobyte guide, `docs/helper.md` describes the third, and AGENTS.md's own
table claims there are *two* doors. Somebody arriving with an agent and a
question — *which of these am I?* — has nothing to read, and the answer decides
what they fetch next.

This matters more than a landing page usually would, because there is no CMS
and there will not be one (decision 24). The document **is** the product for
everybody not standing in the checkout.

## Work

- One short page, linked from `/documentation.txt` and from `/agent.md`'s
  opening, that names the four and says in one paragraph each: what it costs,
  what it needs, and what it cannot do. Not a comparison table with ticks — a
  paragraph a person or a model reads once and picks from.
- Say the unobvious parts plainly: that an agent token reaches `/api/…` and
  never a rendered page; that everything an agent writes is a draft and
  publishing is a second call; that the helper's model spends the journal's
  credits and your own agent's does not.
- **B311 is the larger half of this** and should probably land first or
  alongside — a chooser that points at a fifty-six kilobyte document has moved
  the problem one hop.
- Add the fourth way only once it exists. A guide describing a channel nobody
  can use is the same failure as B386's footer.

Not doing: rewriting `/agent.md`. That is B311.

## Acceptance

An agent handed only `https://<site>/documentation.txt` reaches the right
document for its situation in one hop, and a person reading the same page can
say which of the four they are.
