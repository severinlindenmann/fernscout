---
id: B499
title: Nothing shows an agent how to build a character, and the demo journal has one party shape
type: DOCS
priority: medium
complexity: low
area: travellers, demo content, agent-interface
found: "2026-09-05T16:28:47Z"
started: "2026-09-05T16:29:15Z"
session: c3c8ffc8-e9b2-4d46-b1b7-942387750255
claimed: "2026-09-05T16:29:15Z"
---

# B499 — Nothing shows an agent how to build a character, and the demo journal has one party shape

## Why

Two halves of one problem: an agent asked to draw somebody has the vocabulary
but no worked example, and a person looking at the demo journal cannot see
that parties have shapes at all.

**The reference is complete and the instructions are thin.** `GET
…/travellers/presets` returns every word a figure takes, which answers *what
may I say* and not *how do I build one*. `/agent.md` has a section that argues
the rules — ask, never infer, show before writing — and does not once show a
figure being assembled from an answer. An agent that has read all of it still
has to guess at the shape of the object it is meant to POST.

**The demo journal draws the same party five times.** Four of the five trips
have no `travellers:` block at all, so they render one neutral figure each;
`usa-2026` has a couple. Nothing in `content/example/` shows a family, a group,
a solo traveller, or the journal-level default — so the arrangement work in B11
(children in front, ranks alternating past three, the overlap) is invisible to
anybody looking at the demo, which is the thing the demo exists for.
`docs/README.md` calls the demo content what an agent learns the model from.

## Work

1. **A worked example in the guide.** One conversation end to end in
   `/agent.md`: the question, a person's answer in ordinary words, the figure
   it maps to, the preview URL, the read-back naming what stayed at the
   default, and the POST body. Prose about the rules stays; this is what was
   missing under it.
2. **`…/travellers/presets` explains its own fields.** It lists the values a
   field takes and never says what the field means or which are worth asking
   about. Add a per-field line, and the shape of a figure object, so the
   response is usable without also reading `/agent.md`.
3. **Give every demo trip a different party.** Solo, a couple, a family with
   children, a group of five, and one trip with **no block at all** so the
   journal-level default in `content/example/config.json` is demonstrated
   rather than merely documented.

Not doing: a second copy of the vocabulary anywhere. It lives in
`lib/travellers/vocabulary.ts` and is served from the presets endpoint; a
reference kept in two files disagrees with itself within a month, which
`AGENTS.md` says at length about exactly this kind of table.

## Acceptance

- `/agent.md` carries one complete worked example, answer to written block.
- `GET …/travellers/presets` says what each field is for, and shows a figure
  object.
- Each of the five trips in `content/example/` renders a visibly different
  party, and one of them has no `travellers:` block and falls back to the
  journal's.
- `.claude/skills/describe-a-traveller/SKILL.md` matches, without restating
  the vocabulary.
