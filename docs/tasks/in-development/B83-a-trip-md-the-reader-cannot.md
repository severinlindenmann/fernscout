---
id: B83
title: A trip.md the reader cannot parse is dropped silently, so a broken trip and no trip look the same
type: ISSUE
priority: high
complexity: low
area: trips, validation, ui
found: "2026-09-01"
started: "2026-09-03"
---

# B83 — A trip.md the reader cannot parse is dropped silently, so a broken trip and no trip look the same

## Why

Found on 2026-09-01 while building **B75**, and it is the failure mode that
task's fix walks straight into.

`readTrip` (`lib/trips.ts:288`) returns `null` — which removes the trip from
`getTrips` entirely — when a `trip.md` has an `id` that does not match its
folder name, has no title, has a `start` or `end` that is not an ISO date, or
has frontmatter that will not parse. Each case logs a `[trips]` warning to the
server console and does nothing else.

Nothing downstream can tell that apart from the folder not existing. So a
journal whose only trip is malformed now tells its owner, in the words B75 and
B76 just added, that the journal has no trips yet and they should hand two
lines to an agent. The trip is on disk. Its author wrote it. The site says it
is not there.

Two things make this worse than a normal validation gap:

- **The console is not where the owner is.** A self-hosted instance's stdout
  goes to the container log. The person who needs the message is reading a web
  page, and the warning is written somewhere they will never look.
- **An agent is the likely author.** Writing happens through the API and MCP
  (decision 24), and `createTrip` in `lib/tripWrite.ts` is not the only way a
  `trip.md` gets written — the `add-a-trip` skill writes the file directly. An
  agent that mis-formats a date has no way to discover it: the write succeeds,
  the file is on disk, and every read pretends it is not.

This is the same shape as **B72**, which is why it is worth doing now: there a
trip was present but rendered as though empty, here a trip is present and
rendered as though absent, and in both cases the author's only signal is a page
that quietly disagrees with what they wrote.

## Work

Two halves, and the second matters more than the first.

**Tell the owner.** A malformed trip should reach a surface the owner actually
reads. The trip list (`app/[user]/trips/`) is the obvious place — it is where
B76 put the empty state, and it is where somebody goes when a trip is missing.
Show the folder name and what is wrong with it, to the owner only: the parse
error of somebody's `trip.md` is not a stranger's business.

**Tell the writer.** An agent that has just written a `trip.md` should be able
to find out that it did not take. Whether that is validation at write time in
`lib/tripWrite.ts`, an entry in `/api/health`, or a field in the read-back the
API already offers is the design question this task has to answer — B47 covers
the parallel case for the `test:` flag and is worth reading first, because the
answer probably wants the same shape.

Deliberately **not** proposed: making `readTrip` return a partial trip and
render it anyway. A trip with no valid `start` cannot be placed on a timeline,
and half-rendering it would push the failure into every consumer instead of
holding it in one place.

Related: **B75** and **B76** (the empty states this misleads through), **B72**
(the same class of silent disagreement), **B47** (a written field nothing can
read back).

## Acceptance

- A journal containing exactly one trip, whose `trip.md` fails each of the four
  rejection cases in turn, does **not** tell its owner the journal is empty.
- The owner can see which folder is broken and why, from the site.
- A stranger reading the same journal sees no folder names and no parse errors.
- Something an agent can call reports the malformed trip, so a writer can
  discover its own failure without shell access.
