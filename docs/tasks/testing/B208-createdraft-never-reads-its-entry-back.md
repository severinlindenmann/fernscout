---
id: B208
title: createDraft never reads its entry back, so an unwritable day is reported as written
type: ISSUE
priority: low
complexity: low
area: api, entries
found: "2026-09-04T06:14:14Z"
started: "2026-09-04T07:52:19Z"
merged: "2026-09-04T08:19:52Z"
---

# B208 — createDraft never reads its entry back, so an unwritable day is reported as written

## Why

Noticed while fixing B204, which was the trip half of exactly this.

`createTrip` reads the trip back after writing it (`lib/tripWrite.ts`) and now
rolls the folder back if it does not parse, because a file the reader cannot
load is invisible at every reading path and the caller has to hear about it
now. `createDraft` (`lib/api/entries.ts`) does neither: it writes the file,
calls `forgetEntries` and returns `{ok: true, slug, status: "draft"}`.

B204 also fixed the one way a caller could reach that state — `quote()` did not
escape newlines, so a `location`, `country` or `transportFrom` containing one
closed the frontmatter block from inside the value. Both writers now share
`quoteScalar` in `lib/validate/frontmatter.ts` and there is no known input that
produces an unparseable entry today. So this is the asymmetry rather than a
live bug: the trip path fails loudly on a file that does not read and the day
path would report 201 over one.

The consequence if it ever happens is smaller than B204's — a day slug is not
an id anybody else needs, and `DELETE .../days/<slug>` resolves the file by
name rather than by parsing it, so an unreadable draft can still be removed.
That is why this is low rather than high.

**Corrected while building: "invisible at every reading path" understates it.**
`readAllEntries` (`lib/entries.ts:148`) calls `matter(raw)` per file with no
guard, and gray-matter throws on invalid YAML — so one unparseable entry does
not hide one day, it takes the whole trip down. Measured, on a trip with one
good entry beside one bad one: `getAllEntries` threw and the good entry was not
returned. That does not change what this task builds, and it does raise what
the guard is worth. The reading side of it is captured as **B236**; the
priority here is left at low because with this guard in place there is no
longer a way to reach the state through the API at all.

## Work

- Read the entry back after writing it, the way `createTrip` does, and remove
  the file and answer an error if it does not parse.
- Check first whether `getDays`/`getEntryBySlug` can be asked about a single
  freshly written file cheaply enough to sit on the write path; if the only
  way is re-reading the whole trip, say so in this file and consider parsing
  the written string directly instead.

Not doing: validation of the individual fields. `lib/validate/entry.ts`
already covers those, and the point here is the guard that does not depend on
having thought of the input.

## What was built

**The read-back is one file, not the trip.** The question the Work section
asks has an answer and it is no: `getEntryBySlug` goes through
`getAllEntries`, which re-reads and re-parses every entry in the trip, and
`forgetEntries` has just been called — so on a two-hundred-day trip the
obvious read-back would be two hundred file reads to check one file, on the
commonest write in the system. `draftDoesNotReadBack` (`lib/api/entries.ts`)
therefore reads the one file and parses it with the same `matter` the reader
uses, which is the only step in `readAllEntries` that can fail on a file this
function wrote.

It asks three questions rather than one, and the last two are the interesting
ones: a frontmatter block that ends early does not always *fail* to parse — it
can parse into something else, with the rest of the block landing in the prose
and taking `status: draft` with it. So the title and the date are asserted to
read back as written, and the day is asserted to still be a draft. A day that
was written as a draft and reads back published is the one outcome here worse
than an invisible file.

A failed read-back removes the file, for the same reason B204 removes the trip
folder: a slug held by a file nothing can read would refuse the retry with `an
entry already exists` while showing nothing on the site. The message says the
slug is free again, or — if the removal itself failed — which file has to be
deleted on the server.

`WriteResult` gained an optional `bug: true`, and the days route answers **500**
for it rather than the blanket 400. A 400 tells the caller their request was
wrong when it was not, and advises the opposite of the right next move: nothing
was kept, so the same call should simply be sent again.

## Acceptance

- A `createDraft` whose file does not parse answers an error and leaves no
  file behind, with a test that forces the failure. ✅ —
  `test/draft-read-back.test.ts`, which mocks `quoteScalar` to a version that
  escapes nothing (the pre-B204 regression class, a little wider so both
  failure shapes are reachable). Two cases: the block that will not parse, and
  the block that parses with `status: draft` in the prose. Both assert
  `fs.readdirSync(entries/)` is empty afterwards.
- An ordinary draft is unaffected, and the write path costs no extra full trip
  read per entry — or the file says why that is acceptable. ✅ — asserted, not
  argued: with two entries already on disk, `fs.readFileSync` is spied on and
  the only entry file read during the write is the one just written.

## Evidence

```
$ npx vitest run test/draft-read-back.test.ts        # with lib/api/entries.ts stashed
  Tests  3 failed | 1 passed (4)
$ npx vitest run test/draft-read-back.test.ts        # with the fix
  Tests  4 passed (4)
```
