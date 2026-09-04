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
