---
id: B1070
title: The three ways to reach this journal are not written down anywhere as three ways
type: DOCS
priority: high
complexity: medium
area: agent docs, byoa
found: "2026-09-09T07:11:58Z"
started: "2026-09-11T14:10:10Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T14:10:10Z"
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

## Decided — 2026-09-09

Answered by the owner:

- **Three ways, not four.** The helper at `/agent`; a messenger; your own
  agent against the published spec. "Guided" and "spec-reading" collapse into
  the third, because the difference between them was always how much had to be
  read before the first correct call — which is B311's problem, not a product
  boundary.
- The page must also carry the rule decided in B1068: **the instance's own
  model and transcription are not part of the API.** An agent bringing its own
  model needs to learn that from the document rather than from a 404.
- All three locales from the start (en, de, hu), written properly.

## Decided further — 2026-09-09

- **`fernscout-helper` is part of "your own agent", not a fourth door.** It is
  an agent you bring that happens to run on your own machine and push through
  the same API. So the page still names three ways in, and mentions the local
  repository as one way of doing the third — with a pointer to
  `docs/helper.md` rather than a restatement of it.
- It is worth a sentence rather than a footnote: it is the most useful option
  for somebody sitting with ten days of photographs on a laptop, and the
  chooser page is where they will be standing when that is true.
