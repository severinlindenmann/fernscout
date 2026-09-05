---
id: B498
title: Every traveller is drawn in trousers
type: FEATURE
priority: medium
complexity: low
area: travellers, brand
found: "2026-09-05T16:26:59Z"
---

# B498 — Every traveller is drawn in trousers

## Why

`lib/travellers/render.ts` draws one lower body: two rounded rects in
`pants`, at `x=21` and `x=33.5`. That is the only garment there is. Somebody
who wears a dress, a skirt, a sari, a robe or a kilt cannot be drawn as
themselves on their own journal — the figure will always be in trousers, and
the only thing they can change is the colour of them.

It came out of asking whether B11 should have a `gender` field. It should not,
and that is settled: everything gender would control is chosen directly, and a
two-way switch makes the software assert something about a person. But the
question was pointing at something real. What a person actually reaches for a
gender switch to *get* is often "draw me in a dress", and today there is no
way to ask for that at all.

So this is the same shape as every other attribute in the vocabulary —
something the person chooses and states about themselves, with no inference
anywhere — rather than a re-run of the gender argument.

## Work

An `outfit:` field beside `shirt` and `pants`, defaulting to `trousers` so
every figure written before this renders exactly as it does now.

Candidates, and the list is the decision worth making rather than the code:
`trousers`, `skirt`, `dress`, `robe`, `shorts`. A `dress` replaces the torso
and legs as one shape and so takes `shirt` as its colour; a `skirt` keeps the
torso and replaces the legs, and wants its own colour or borrows `pants`.
Decide that before drawing, because it determines whether `outfit` is one
field or two.

Also: `AGE_SCALE` shrinks the whole figure, so a child in a dress has to read
as a child in a dress rather than a small adult. Check it at `child` scale
before calling it done.

Not doing: anything that infers an outfit from anything. Not from a name, not
from a photograph, not from a starting point — a starting point may *offer*
one, and the person says yes or no, exactly as with hair. The four rules in
`.claude/skills/describe-a-traveller/SKILL.md` apply unchanged and the skill
needs a line for this field.

Not doing: a `gender` field. See B11 for why, and do not reopen it here.

## Acceptance

- A figure with `outfit: dress` draws a dress, at every `age` and every
  `build`, and `test/travellers.test.ts` covers each outfit the way it covers
  each hair style today.
- A figure with no `outfit:` is drawn byte-identically to today — a test
  comparing the rendered SVG before and after is the cheapest way to say so.
- `GET /api/v1/<user>/travellers/presets` lists the outfits, and
  `travellersBlock` in `lib/tripWrite.ts` refuses an unknown one by name.
- At least one starting point offers something other than trousers, so the
  vocabulary is discoverable rather than merely present.
