---
id: B620
title: The published file shape offers a day the option of being fake, and drops two real ones
type: ISSUE
priority: high
complexity: low
area: content model, api
found: "2026-09-06T16:16:42Z"
---

# B620 — The published file shape offers a day the option of being fake, and drops two real ones

## Why

Found on 2026-09-06 by validating a real journal against the live
`content-model.json` and diffing the result against `model.mjs`. Errors and
warnings matched exactly — 0 and 0 from both. Four **tips** did not, and two of
them matter.

**`test` is now offered.** `model.mjs` marks it `noTip: true` in both places it
appears (lines 99 and 128) — deliberately, because `test:` means *content
nobody lived, written to prove the pipeline works*. The document has no way to
express `noTip`, so a client reading it offers `test` as an available option on
every day of somebody's real holiday.

That is the worst kind of tip this repository can print. `validate-content`'s
own instructions say the tips are to be read out to a person as *choices
available*; "you could mark this day as one that did not happen" is a choice
nobody should be offered about a trip they took, and an agent working down a
tip list is exactly who might take it.

**`cover` and `travellers` are no longer offered.** Both are `fileOnly` keys
with real tips in `model.mjs` — a trip's cover photograph and how the party is
drawn. Neither survives into the document, so two genuine options a person
might want silently stop being mentioned.

Nothing is broken today: the tip difference does not gate publishing, and
`model.mjs` is still the fallback. It becomes permanent at B610, which deletes
`model.mjs` — so this is a **blocker for B610**, and that is the reason it is
filed as high rather than as a cosmetic difference.

The underlying gap is that W41 chose "shape **and the words** and the rules",
and the document currently carries the shape and the rules. The prose a reader
sees is coming from `openapi.json`'s field descriptions instead, which is why
most tips read *better* from the document than from `model.mjs` — and why the
two keys with no API presence at all lost theirs.

## Work

- Express "do not offer this" in the document. `test` is the only key that
  needs it today. A rule kind is not obviously right for a negative — it may
  belong on the key's own entry under `files[…]` rather than in `rules[]`;
  decide, and say why in the code.
- Carry the tip prose for keys that have no `openapi.json` description to
  borrow — `cover` and `travellers` are the two found, but check the whole of
  `model.mjs` for others rather than fixing only these.
- Add to `test/content-model.test.ts` an assertion that every key `model.mjs`
  suppresses is suppressed by the document, and every key it tips is tippable
  from the document. That comparison is what would have caught this before it
  was published.
- Re-deploy, then re-run the helper against the live document and diff the tip
  sets again. The four differences should go to zero.

## Acceptance

- Validating `content/severin` from the document and from `model.mjs` produces
  **identical tips**, not merely identical errors and warnings.
- `test` is offered by neither.
- `cover` and `travellers` are offered by both.
- `npm run verify` green, and the conformance test fails if a suppressed key
  becomes tippable.
