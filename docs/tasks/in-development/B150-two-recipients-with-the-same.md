---
id: B150
title: Two recipients with the same Latin name overwrite each other's postcards
type: ISSUE
priority: low
complexity: low
area: postcards, scripts
found: "2026-09-03"
started: "2026-09-04T06:30:09Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:30:09Z"
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
