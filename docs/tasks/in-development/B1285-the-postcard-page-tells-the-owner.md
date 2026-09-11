---
id: B1285
title: The postcard page tells the owner to answer an API endpoint and write a YAML block
type: ISSUE
priority: medium
complexity: low
area: postcards, i18n
found: "2026-09-10T10:51:58Z"
started: "2026-09-11T04:33:25Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T04:33:25Z"
---

# B1285 — The postcard page tells the owner to answer an API endpoint and write a YAML block

## Why

Step 2 of `/<user>/postcards/<id>` — the page the owner opens on their phone to
look at a card before spending twenty credits on it — carries this line:

> Nobody has been described for this trip, so there is nothing to draw. **Answer
> /travellers/presets and write a `travellers:` block to change that.**

`postcard.page.figuresNone`, rendered at `app/[user]/postcards/[id]/page.tsx:356`.

The person reading it has no way to do either. There is no editor here — that is
the whole design (ROADMAP decision 24) — so "write a `travellers:` block" names a
file they have never seen, and "answer /travellers/presets" names an HTTP
endpoint. It is a sentence for an agent, printed on the one page AGENTS.md says
is deliberately **not** an agent's:

> The owner opens that page, sees the photograph, the message on the back, who
> each card is going to, the cost and their balance, and presses one button.

German and Hungarian carry it too, endpoint and all — *"Antworte
/travellers/presets und schreibe einen travellers-Block"*, *"Válaszolj a
/travellers/presets alapján, és írj egy travellers blokkot"* — so it is not an
English-only slip.

The first half of the sentence is fine and worth keeping: nobody has been
described, so there is nothing to draw. What follows should be what the person
can actually do, which is ask the helper.

## Work

- Rewrite the second half in all three locales for somebody with no agent: this
  is something to ask for in the room, not a call to make.
- While in there, grep the `postcard.page.*` and `photobook.*` blocks for other
  endpoint paths and field names — this one was found by reading one screen, and
  B1250, B1277 and B1284's refusal are the same family.

## Acceptance

- No string rendered on `/<user>/postcards/<id>` contains a path beginning with
  `/` or a YAML key.
- The sentence still says why no figures are drawn.
