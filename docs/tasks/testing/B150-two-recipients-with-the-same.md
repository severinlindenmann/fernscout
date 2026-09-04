---
id: B150
title: Two recipients with the same Latin name overwrite each other's postcards
type: ISSUE
priority: low
complexity: low
area: postcards, scripts
found: "2026-09-03"
started: "2026-09-04T06:30:09Z"
merged: "2026-09-04T07:17:24Z"
---

# B150 — Two recipients with the same Latin name overwrite each other's postcards

## Why

Found while building **B86**, and deliberately not absorbed into it: B86 is
about a name that slugs to *nothing*, this is about two names that slug to the
*same thing*. Same consequence, different trigger, and the fix B86 shipped does
not reach it.

`recipientBase` (`lib/postcard/filename.ts`) returns the batch position only
when the slug is empty:

```ts
return slug(name) || `recipient-${index + 1}`;
```

Two recipients both called "Anna Meier" — a mother and a daughter, two people
in one family, the same person listed twice by mistake — both slug to
`anna-meier`, and the second run of `fs.writeFileSync` in `scripts/postcard.ts`
replaces the first. The batch reports both:

```
  Anna Meier -> content/example/postcards/anna-meier.pdf
  Anna Meier -> content/example/postcards/anna-meier.pdf
```

and one card exists. This is the same silent overwrite B86 describes, with the
same evidence available to the author — a folder holding fewer files than the
address list, and nothing saying which are missing.

It is filed `low` where B86 was `low` too, but the population is different and
worth stating: B86 fell entirely on people whose names are not written in Latin
script, which is why it mattered more than its scale suggested. This one falls
on anyone with a common name, and duplicate names in a postcard batch are
ordinary rather than exotic — a christening, a wedding, a family list.

Not a data-loss bug beyond the run: the addresses are in the author's own JSON
and re-running after a rename produces both cards. The cost is that nothing
tells them to.

## Work

Decide whether the name is the identifier at all.

- The narrow fix is to disambiguate on collision within the batch rather than
  on emptiness — append the position when a base has already been used, so the
  first `anna-meier` keeps its name and the second becomes `anna-meier-2`.
  Cheap, and it leaves every existing filename alone, which the B86 acceptance
  cared about ("recipients with Latin names keep the filenames they get today").
- The broader answer is that the position is the only thing in a batch that is
  actually unique, and the name is decoration. Numbering every file
  `01-anna-meier.pdf` would be honest and would also sort the folder in the
  order of the address list. It changes every filename, which is why it is a
  decision rather than a patch.

Whichever: the run should say when it has renamed something, because the author
is about to hand these to a printer and needs to know which card is whose.

**Not doing:** `lib/slug.ts`. B77 rejected unifying the private slug copies and
that still holds — this is about what happens *after* the slug, not about the
slug rule.

## Acceptance

- A batch containing two recipients with the same name produces two distinct
  cards, and the run says so.
- A batch with no repeated names produces exactly the filenames it does today.
- A test covering both, alongside the B86 cases in `test/postcard.test.ts`.

## What was built

**The narrow fix, and the Work section's two options are the reason.**
Numbering every card `01-anna-meier.pdf` was the honest option and it renames
every file anybody has generated; B86's acceptance — "recipients with Latin
names keep the filenames they get today" — is the promise kept instead, and
B202 lands in the same function with the same promise. So a name is claimed by
whoever holds it first in the list, and only a second claimant is numbered.

`recipientBases(names: string[])` in `lib/postcard/filename.ts` is the new
entry point: it names a *batch* rather than one recipient, because collision is
a property of the batch and `recipientBase` cannot see one. It returns the
name, the base, the base that was wanted, and whether the two differ.
`recipientBase` stays exactly as it was, and is what the batch function asks
for each name; its docstring now says which of the two a run should call.

The suffix counts up past whatever is taken rather than stopping at `-2`, so a
hand-written "Anna Meier 2" further down the list is pushed to
`anna-meier-2-2` rather than being written over. Ugly and rare, and the
alternative is the defect this task is about. Deterministic: the same JSON in
produces the same filenames out, which is what somebody re-rendering a batch
after fixing one address needs.

**The run says so**, which the Work section asked for:

```
  Anna Meier -> content/example/postcards/anna-meier.pdf
  Anna Meier -> content/example/postcards/anna-meier-2.pdf
      ~ renamed: another recipient in this batch is already anna-meier.pdf
  Anna Straßer -> content/example/postcards/anna-strasser.pdf
  Δημήτρης Παπαδόπουλος -> content/example/postcards/recipient-4.pdf

1 card(s) were renamed because two recipients share a name.
Check the lines marked ~ above before posting them: the files are distinct,
but only the address inside says which card belongs to whom.
```

That is a real `npm run postcard` against the example journal with the
`dry-run` backend — sixteen files for four recipients, where the old code left
twelve and reported four names.

Five tests in `test/postcard.test.ts`, all red before the change: the
collision, the untouched batch (asserted against `recipientBase` itself, so
the B86 promise cannot drift), the suffix walking past a taken name, the
same-list-twice determinism, and two empty slugs still not colliding.

**Found while here, filed rather than absorbed:** B218 (the run reports three
files per recipient and writes four) and B219 (this script and the photobook
one write to `process.cwd()/content` rather than `contentRoot()`, which on the
deployed server puts postal addresses outside the backup — B111's shape).
