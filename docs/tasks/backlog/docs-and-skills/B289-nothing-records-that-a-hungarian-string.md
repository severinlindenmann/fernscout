---
id: B289
title: Nothing records that a Hungarian string cannot take a case suffix on an interpolated name
type: DOCS
priority: low
complexity: low
area: i18n
found: "2026-09-04T13:08:34Z"
---

# B289 — Nothing records that a Hungarian string cannot take a case suffix on an interpolated name

## Why

Found while writing B278's three translations, and it is the second time the
same constraint has been re-derived from scratch.

Hungarian marks grammatical case with a suffix, and the suffix depends on the
vowels of the word it attaches to — *Vikitől* but *Somtól*. So a Hungarian
sentence of the form "ask {name} for an invite link" cannot be written the way
English and German write it: any suffix chosen for `{name}` is wrong for some
names, and there is no correct default because the name is an arbitrary string
somebody typed into their own `config.json`.

B278's answer, and `me.strangerBodyNamed`'s before it, was to restructure the
Hungarian sentence so `{name}` sits in subject position and needs no suffix —
*"Viki tud küldeni meghívólinket"* rather than an inflected form. That works,
it is invisible to the reader, and **it is written down nowhere.** Both times it
was worked out by whoever happened to be writing that string, and the next
`{name}` string in Hungarian is one where somebody guesses instead.

The failure it prevents is not a crash and not a test failure. It is a sentence
that reads as broken Hungarian to a Hungarian reader and to nobody else — the
kind of defect this project has no way to notice, since nobody reviewing the
diff speaks the language and every check stays green.

## Work

Write it down where somebody adding a string will meet it, which is not a task
file. The candidates, in order of how likely they are to be read:

- A comment beside the affected keys in `hu.json` — but a JSON file takes no
  comments, so this may mean a note in whatever prose covers the dictionaries.
- `docs/` — find whether there is an i18n document already and add it there;
  if there is not, this is one short section rather than a new file.
- `content/locales/README` or equivalent, if one exists.

Say the rule as a constraint on the *English* string, because that is the one
being written when the mistake is made: **a string that interpolates a person's
name should place it where a language that inflects names can leave it
uninflected** — subject position, or after a preposition the translator can
restructure around. Name the two existing strings as the worked examples, since
a rule with no example gets read as pedantry.

While there, check whether German has the same problem in any existing string —
it inflects less but not never, and the same restructuring may already be
load-bearing somewhere nobody noted.

Not in scope: any tooling to detect it. There is no automatic check for "this
reads as broken Hungarian", and pretending otherwise would be worse than the
note.

## Acceptance

Somebody adding a `{name}` string finds the constraint without asking, and the
two existing Hungarian strings that depend on it say why they are phrased as
they are.
