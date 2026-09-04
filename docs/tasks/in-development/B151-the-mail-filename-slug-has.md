---
id: B151
title: The mail filename slug has no NFD pass, so a German umlaut loses its vowel
type: CHORE
priority: low
complexity: low
area: mail, slugs
found: "2026-09-03"
started: "2026-09-03T20:05:28Z"
session: d6791268-ed45-4a69-acde-99f9e5f10516
claimed: "2026-09-03T20:05:28Z"
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

> **Corrected while building.** The postcard copy does **not** get `grusse` —
> it gets `gru-e-vom-weg`. NFD has nothing to decompose in `ß`, so that copy
> drops the letter to a hyphen exactly as this one does; only `lib/slug.ts`,
> which spells it out from a table before normalising, produces a whole word.
> So "match `lib/postcard/filename.ts`" below would have left this task's own
> acceptance unmet. Filed as **B202**.

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

## What was built

`"Grüße vom Weg"` → `grusse-vom-weg`, from `gr-e-vom-weg`.

**The ß question the Work section flagged answered itself**, and not the way
the Why assumed. The premise was that two copies already agree and this one is
the odd one out; in fact they disagree with each other. `ß` has no
decomposition, so NFD cannot touch it and the character class that follows
turns it into a hyphen — the postcard copy produces `gru-e-vom-weg`, only one
letter better than doing nothing. Copying it would have satisfied the Work
section and failed the Acceptance one line below it. So `ß` is spelled out
here with a line of its own, before the NFD pass, and **B202** carries the
same line back to the postcard copy.

**The transliteration table was deliberately not copied.** `ü` folds to `u`
here where `lib/slug.ts` gives `ue`, so this subject is `grusse-vom-weg` on
disk and `gruesse-vom-weg` in a permalink. That table earns its keep by
keeping "Rückfahrt" and a jolt apart in an address somebody has already
shared, for ever. Nothing this function names is shared, resolved or
permanent — `writeEml` owns uniqueness, the folder is gitignored, and the file
is read once and deleted. Recognisable was the whole requirement and `grusse`
is recognisable, so the two rules stay uncoupled, which is what B77 decided and
B86 restated. The reasoning is in the docstring rather than only here, since
that is where the next person will be standing when they wonder.

The test asserts on the two letters for the two different reasons — `ü`, which
NFD decomposes, and `ß`, which it does not — and pins the divergence
explicitly (`not.toContain("zuerich")`), so a later well-meant unification has
to argue with a test rather than slip through.

Untouched on purpose: `slice(0, 60)` can still leave a trailing hyphen, which
`lib/slug.ts` re-trims and this copy does not. It is the same before and after
this change and it is not what the task is about.
