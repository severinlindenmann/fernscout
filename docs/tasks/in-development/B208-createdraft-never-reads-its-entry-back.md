---
id: B208
title: createDraft never reads its entry back, so an unwritable day is reported as written
type: ISSUE
priority: low
complexity: low
area: api, entries
found: "2026-09-04T06:14:14Z"
started: "2026-09-04T07:52:19Z"
session: 7d30451d-0304-4631-8484-d96036fb11b4
claimed: "2026-09-04T07:52:19Z"
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

## Acceptance

- A `createDraft` whose file does not parse answers an error and leaves no
  file behind, with a test that forces the failure.
- An ordinary draft is unaffected, and the write path costs no extra full trip
  read per entry — or the file says why that is acceptable.
