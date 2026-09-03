---
id: B86
title: A recipient whose name has no ASCII gets an empty postcard filename, and each one overwrites the last
type: ISSUE
priority: low
complexity: low
area: postcards, scripts, slugs
found: "2026-09-01"
started: "2026-09-03"
---

# B86 — A recipient whose name has no ASCII gets an empty postcard filename, and each one overwrites the last

## Why

Found on 2026-09-01 while building **B77**, which unified the two `slugify`
implementations that name *permalinks*. This is a third copy that names
*files*, and it was left alone on purpose — the comment now at
`scripts/postcard.ts:63–68` records why: it names generated output in a
gitignored folder that is rewritten on every run, so it is not bound by the
promise a permalink makes.

That reasoning holds, and it does not cover this. The function has **no
fallback**:

```ts
function slug(text: string): string {
  return text.toLowerCase().normalize("NFD")…
}
```

`lib/slug.ts` returns `"entry"` when nothing survives; this returns `""`. A
recipient whose name is written in Greek, Cyrillic, Hebrew, Chinese, Japanese,
Korean, or any other non-Latin script produces an empty base name, and the
files become `.pdf` and `-front.pdf` — dotfiles, hidden from a plain `ls`, in a
folder the author is expected to open and send to a printer.

Worse than hidden: **they collide.** Every such recipient writes to the same
two names, so a run addressed to several of them silently produces one card.
The author's evidence that anything went wrong is a folder with fewer files
than recipients, and nothing says which are missing or why.

The scale is small — postcards are a per-run, per-recipient batch — but the
failure is silent, and it lands only on recipients whose names are not written
in Latin script, which is the wrong population to fail quietly for.

## Work

Give the function a fallback, as `lib/slug.ts` has. `recipient` or the
recipient's index in the batch both work; the index has the advantage of not
colliding when two such names appear in one run, which is the actual defect —
a shared constant would keep the dotfile problem away but not the overwrite.

Do **not** fold this into `lib/slug.ts`. B77 considered and rejected that: the
three private copies differ in their fallback word, and parameterising the
shared slug rule is a weaker guarantee than an unparameterised one. This wants
its own fallback, not a shared function with an option.

While there, `lib/mail/index.ts:22` is the third copy and has the opposite gap
— no NFD pass at all, so "Grüße vom Weg" becomes `gr-e-vom-weg`. Cosmetic,
dev-only `.eml` filenames, no collision. Fix it in passing or leave it; say
which.

## Acceptance

- A postcard run addressed to two recipients whose names contain no ASCII
  produces four distinct, non-hidden files.
- A test over the naming function covering a non-Latin name and two of them in
  one batch.
- Recipients with Latin names keep the filenames they get today.

## What was built

**The fallback is the recipient's position in the batch**, one-based:

```ts
export function recipientBase(name: string, index: number): string {
  return slug(name) || `recipient-${index + 1}`;
}
```

The Work section offered `recipient` or the index and noted the index does not
collide. That is the deciding argument and it is worth stating plainly: a
shared constant fixes the *hidden dotfile* and leaves the *overwrite*, and the
overwrite is the half that loses somebody's post. The dotfile is a nuisance;
one card where there should be three is the defect.

### It moved to `lib/postcard/filename.ts`

The acceptance asks for "a test over the naming function", and the function
could not be reached by one: `scripts/postcard.ts` parses `process.argv` and
calls `process.exit` at import time, so importing it from a test runs the
script. The function and its private `slug` now live in
`lib/postcard/filename.ts` and the script imports them.

This is **not** the merge B77 rejected. It is still a private copy with its own
unparameterised fallback, sitting beside the other `lib/postcard/` modules; it
did not become an option on `lib/slug.ts`. The comment in the new file records
B77's reasoning so the next person does not undo it.

### Evidence

A real run, `--backend dry-run`, four recipients, three of them written in
non-Latin scripts:

```
Rendering 4 postcard(s) with the dry-run backend.
  Δημήτρης Παπαδόπουλος -> content/example/postcards/recipient-1.pdf
  Владимир Ильин        -> content/example/postcards/recipient-2.pdf
  山田 太郎               -> content/example/postcards/recipient-3.pdf
  Ana Bergström         -> content/example/postcards/ana-bergstrom.pdf
Wrote 12 file(s) to content/example/postcards/
```

Sixteen distinct files, none hidden, and the Latin name is unchanged from what
it produced before. Against the pre-change function the three new naming tests
fail:

```
× a name in a non-Latin script gets a name instead of nothing
× two such names in one batch do not collide
× a mixed batch numbers by position, so a name never moves another's file
  Tests  3 failed | 19 passed (22)
```

### `lib/mail/index.ts` — left alone, and why

The *While there* paragraph offered the third slug copy, which has no NFD pass
at all. **Left alone**, as the task permitted, and the reason is not
tidiness: **B50** was being built against `lib/mail/index.ts` in a parallel
worktree at the same moment, and touching it here would have collided in one
file for no gain. Captured as **B151** so the note is not lost.

One thing found while building, captured rather than absorbed: **B150** — two
recipients with the *same* Latin name still overwrite each other, because the
fallback answers an empty slug and not a duplicate one. Same consequence,
different trigger, and it lands on anyone with a common name rather than on
non-Latin scripts.
