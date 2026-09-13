---
id: B1640
title: "Drafts leaked into the open-to-link export because the draft check still looked for .md"
type: SECURITY
priority: high
complexity: low
area: Export
found: 2026-09-13T00:00:00Z
merged: "2026-09-13T08:01:19Z"
---

## Why

`isDraftEntry` in `lib/exportZip.ts` opened with:

```ts
if (path.extname(file) !== ".md") return false;
```

B1598 made every day a `.json` file. So the check answered `false` for every
day there is, and `open-to-link` — the export scope whose whole point is that
it can be handed to somebody who was **not** invited — carried every draft in
the journal.

A draft is a draft precisely because nobody has decided it should be read
yet. `AGENTS.md`: *"It is the default so that a person can read a day back
before it is on the site."* An export that includes them hands out the one
thing the two-step publish exists to withhold.

The scope's own doc comment says it packages "what an anonymous visitor could
already see". A draft is the clearest possible case of something they could
not.

**Fixed on the B1598 branch** in the same commit as this ticket. Recorded
because the *shape* of the bug matters more than the fix.

## The shape, which is the point

`test/export.test.ts` **already had** the right assertion — "leaves out a
draft entry", naming `.json` files — and it was red. It was one of several
hundred failures on a branch mid-migration, so it read as fixture noise
rather than as a leak.

That is the real lesson: **a security property failing inside a large red
suite is indistinguishable from a broken fixture.** The 1091-failure state
this branch passed through hid it for hours.

Worth doing about it:

- when a branch is deliberately red at scale, security-flavoured tests want
  separating out and running on their own, so a leak cannot hide in the noise;
- **this is the third `.md`-assumption found after the fact** (the others:
  `entrySlugFromFile`, and `lib/ingest` in B1637). A sweep for `".md"` and
  `extname` across `lib/` and `app/` is worth an hour before the migration
  closes — each one is a place that silently answers "no" about every day in
  the journal.

## Acceptance

- `open-to-link` contains no day whose `status` is `draft`. (Done; the
  existing test proves it.)
- A `grep` sweep for remaining `.md` assumptions in `lib/` and `app/`, with
  each hit either fixed or shown to be about the markdown *twin* (a rendering
  feature) rather than storage.
