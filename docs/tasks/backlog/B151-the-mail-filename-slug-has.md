---
id: B151
title: The mail filename slug has no NFD pass, so a German umlaut loses its vowel
type: CHORE
priority: low
complexity: low
area: mail, slugs
found: "2026-09-03"
---

# B151 — The mail filename slug has no NFD pass

## Why

The third private `slug()` copy, at `lib/mail/index.ts:22`, names `.eml` files
for the development mail transport. Unlike the other two it never normalises,
so a composed character is simply deleted rather than folded to its base
letter:

```
"Grüße vom Weg"  ->  gr-e-vom-weg
```

`ü` and `ß` vanish, taking the word with them. `lib/slug.ts` and the postcard
copy both `.normalize("NFD")` first and get `gruesse` / `grusse`.

This is the "opposite gap" named in **B86**'s *While there* paragraph. B86
offered to fix it in passing and it was **left alone deliberately**: B50 was
being built against `lib/mail/index.ts` in a parallel worktree at the same
time, and the two changes would have collided in one file for no reason beyond
convenience. B86 shipped without it; this is the note not being lost.

The cost is genuinely small and should not be overstated. These are
development-only `.eml` filenames in a gitignored folder, nothing resolves
them, and since **B50** they cannot collide — `writeEml` claims each name with
`wx` and walks a counter, so a mangled subject is ugly rather than lossy.
B86's own defect was severe because it *lost* files; this one does not.

What makes it worth a ticket rather than nothing: it is the one remaining copy
that disagrees with the other two, and a person debugging a German or Hungarian
mail flow reads a filename that has silently dropped the word they are looking
for.

## Work

Add the `.normalize("NFD")` pass and the combining-mark strip, matching
`lib/postcard/filename.ts`. Check whether the German ß wants the `ss`
expansion `lib/slug.ts` does — the two disagree today and the answer may be
that they should not.

**Not doing:** unifying the three copies. B77 considered and rejected that, and
B86 restated why: they differ in their fallback and parameterising a shared
slug rule is a weaker guarantee than an unparameterised one. This is one copy
gaining a pass the others already have, not a merge.

## Acceptance

- A mail whose subject is "Grüße vom Weg" produces a filename containing a
  recognisable form of the word, not `gr-e-vom-weg`.
- A test covering an umlaut and the ß, saying which expansion was chosen.
