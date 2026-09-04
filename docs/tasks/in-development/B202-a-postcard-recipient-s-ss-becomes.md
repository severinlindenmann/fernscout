---
id: B202
title: A postcard recipient's ß becomes a hyphen, so a German surname loses a letter
type: CHORE
priority: low
complexity: low
area: postcards, slugs
found: "2026-09-04T04:38:00Z"
started: "2026-09-04T06:30:09Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:30:09Z"
---

# B202 — A postcard recipient's ß becomes a hyphen

## Why

Found while building **B151**, and it is the reason that task could not simply
do what its own Work section said.

B151 was written to say the mail slug should be fixed "matching
`lib/postcard/filename.ts`", on the understanding that the postcard copy folds
"Grüße" to `grusse`. It does not. `slug()` in that file normalises with NFD
and strips the combining marks, which handles `ü`, but `ß` has **no
decomposition** — NFD leaves it exactly as it is, and the `[^a-z0-9]+` class
two lines later turns it into a hyphen:

```
"Grüße vom Weg"   ->  gru-e-vom-weg
"Straße"          ->  stra-e
```

So a recipient called Straßer gets `anna-stra-er.pdf`. B151 added a
`.replace(/ß/g, "ss")` before the NFD pass for exactly this reason, and this is
the same line, in the copy that was supposed to be the model.

**Small, and worth saying how small.** It is not lossy: since B86 the filename
has a fallback, and B150 is the open task about two recipients colliding. This
is one letter becoming a hyphen in a generated filename in a gitignored folder
— the author reads it, hands the PDF to a printer, and nothing resolves the
name. It is filed because the three private slug copies now differ in a way
nobody decided: `lib/slug.ts` spells `ß` as `ss`, `lib/mail/index.ts` spells it
`ss` since B151, and this one drops it.

## Work

- Add the `ß` expansion before the NFD pass, matching what B151 put in
  `lib/mail/index.ts`.
- Decide nothing else. The umlaut question is already settled differently in
  the two private copies on purpose — `ü` is `u` here and in mail, `ue` in
  `lib/slug.ts` — and B151's docstring records why: the transliteration table
  exists to keep two German words apart in a **shared, permanent** address, and
  neither of these names is one.

**Not doing:** unifying the copies. B77 considered it and rejected it, B86
restated why, and B151 restated it again. This is one copy gaining one line
the other two already have.

## Acceptance

- `slug("Straße")` is `strasse`, and a batch addressed to a recipient with `ß`
  in their name produces a filename containing it.
- The B86 promise holds: recipients with plain Latin names keep the filenames
  they get today.
- A case alongside the B86 and B150 ones in `test/postcard.test.ts`.

## What was built

One line, where B151 put its: `.replace(/ß/g, "ss")` after `toLowerCase()` and
before the NFD pass in `lib/postcard/filename.ts`. `slug("Straße")` was
`stra-e` and is `strasse`; a recipient called Anna Straßer gets
`anna-strasser.pdf` rather than `anna-stra-er.pdf`, verified by an actual
dry-run batch:

```
  Anna Straßer -> content/example/postcards/anna-strasser.pdf
```

The test is red against the old function and green against the new one —
`expected 'stra-e' to be 'strasse'` — and it sits with the B86 cases in
`test/postcard.test.ts`. A second test pins the divergence the Why says to
leave alone: `slug("Grüße vom Weg")` is `grusse-vom-weg` and must not contain
`gruesse`, so a later well-meant unification with `lib/slug.ts` has to argue
with a test rather than slip through. The docstring now carries that reasoning
where the next reader will be standing, as B151's does.

**The shared helper was considered and not built.** B150 and this task are the
same function seen twice, so the two are fixed together, but `lib/mail/index.ts`
and this file are still two copies of one rule. Merging them would be the
fourth time the question is asked and the fourth answer would be the same:
B77 rejected it, B86 and B151 restated why, and the copies genuinely differ —
mail falls back to `"mail"` and truncates at 60, a postcard falls back to its
position in the batch (B86) and does not truncate. A shared function would
take both as parameters, which is the weaker guarantee B77 named. What the
copies now share is the *rule* — spell `ß`, then strip the accents — and each
docstring says the other exists.

`recipientBase("ANNA STRAßER", 0)` is covered too: `toLowerCase()` runs first,
so a capital `ẞ` reaches the expansion as `ß`.
