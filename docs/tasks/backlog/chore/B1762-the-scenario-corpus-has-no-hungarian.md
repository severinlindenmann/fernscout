---
id: B1762
title: The scenario corpus has no Hungarian, and inventing it would poison the instrument
type: CHORE
priority: low
complexity: low
area: testing, i18n
found: "2026-09-15T05:34:23Z"
---

# B1762 — The corpus has no Hungarian

## Why

`docs/benchmarks/helper-behaviour/corpus.json` has German and English
wordings. It has no Hungarian, and its own rules say why: the wordings have to
be written by somebody who speaks the language, because inventing them would
put sentences in the instrument that no Hungarian speaker has read, and the
instrument is the thing everything else is measured against.

Hungarian is one of this journal's three languages. A rule that works in
German and fails in Hungarian is invisible today, and the owner would find it
the way every conversational defect has been found so far: personally.

## Work

- A Hungarian speaker writes the wordings for the existing scenarios — clean
  and phone-typed both, as the corpus's own rule requires.
- The runner needs no change: locales come from the keys of `says`, so adding
  `hu` is a data change.
- Where an `answerHasNot` phrase is language-specific, it needs its Hungarian
  counterpart or the scenario relies on `notProposes` alone.

## Acceptance

- `--locale hu` runs and reports, and the numbers are looked at rather than
  assumed to match German.
- No wording in the corpus was written by somebody who does not speak the
  language it is in.
