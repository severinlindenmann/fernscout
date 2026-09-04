---
id: B83
title: A trip.md the reader cannot parse is dropped silently, so a broken trip and no trip look the same
type: ISSUE
priority: high
complexity: low
area: trips, validation, ui
found: "2026-09-01"
started: "2026-09-03"
merged: "2026-09-03"
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

## What shipped (2026-09-03)

`readTrip` (`lib/trips.ts`) no longer discards *why* it rejected a trip. It
returns a `MalformedTrip { folder, problem }` for each of the four failure
cases instead of `null`, keeping the `[trips]` server-log warning as well. A
folder with no `trip.md` at all still returns `null` — not a trip, nothing to
report. `getTrips` is unchanged for every caller; a new `getMalformedTrips`
reads the same cached parse.

**Tell the owner.** `app/[user]/trips/` computes `getMalformedTrips` (owner
only) and renders a coral `MalformedNotice` — the same palette as `DraftNotice`
— naming `trips/<folder>/trip.md` and the problem. The empty state is now
gated on `all.length === 0 && malformed.length === 0`, so a journal whose only
trip is malformed is no longer told it is empty. A stranger is passed an empty
list and sees nothing.

**Tell the writer.** `GET /api/v1/<user>/trips` returns a `malformed` array and
a `next` line, for owner tokens only (`session.scope === write:content`); a
trip-scoped token learns nothing about the rest of the journal. An agent that
mis-dated a `trip.md` now sees it in the read-back instead of a write that
succeeded into a void.

New copy: `trips.malformedTitle{,.one}` / `trips.malformedIntro{,.one}` in en,
de, hu, with the union regenerated by `npm run i18n:keys`. The per-folder
`problem` string stays English (it comes from `lib/trips.ts`); the surrounding
chrome is translated.

Tests: `test/malformed-trips.test.ts` covers each rejection case, that a good
trip is unaffected, and that a folder with no `trip.md` is not reported. Full
suite green (1668), tsc/eslint/build clean.

Not done, deliberately: `readTrip` still does not return a partial trip — a
trip with no valid `start` cannot be placed on a timeline, and half-rendering
it would push the failure into every consumer. Held in one place, as the task's
Work section argued.

## Built twice, and what the second pass changed

Two sessions were handed B83 at the same time and both built it — which is
**B99**, the task about parallel worktrees being handed the same id, happening
to the task list that contains it. The two implementations agreed on the shape
almost exactly: return the refusal instead of dropping it, cache it with the
trips, render a coral owner-only notice. What landed first is above. The second
pass was folded in on top of it rather than replacing it, and changed five
things.

**The reason is translated.** This is the one that mattered. The heading and
the intro were localised; the sentence under them — the half that says what to
actually fix — was built in `lib/trips.ts` and was therefore English on a
German or Hungarian journal, under a German or Hungarian heading. A
`MalformedTripReason` code now travels beside the English `problem`, the panel
translates it (`trips.malformed<Reason>`, six keys × three locales), and the
English stays where its readers are: the server log and the API.

**A folder with no `trip.md` is reported after all**, reversing the decision
recorded above. The reasoning for staying quiet was that such a folder "never
claimed to be a trip" — but nothing else lives directly under `trips/` (a
trip's media are one level further down, at `trips/<id>/media/`), so the only
way to make one is to be halfway through creating a trip. That is exactly the
agent this task exists for: `mkdir` succeeded, the write of the file did not,
and every read afterwards is indistinguishable from never having tried. The
cost of being wrong is one owner-only line that clears when the folder is
finished or removed.

**MCP `list_trips` reports it too.** The REST list had it; MCP did not, and MCP
is how an agent works when it is not making raw HTTP calls. Same owner-scope
rule, said in the tool's text as well as its structured data — a tool result is
read far more often than it is parsed.

**The page stopped rendering four zeroes under a promise.** With `empty` null
and no readable trips, the trip list fell through to the subtitle and the
lifetime tiles: 0 · 0 · 0 · 0 under "everywhere we've been", which is precisely
what B76 removed from the empty journal. It now renders the notice and stops.

**Smaller:** `role="alert"` → `role="note"`, matching `DraftNotice` and
`TestNotice` — an assertive live region interrupts a screen reader to announce
something that was already on the page. `isOwner` is no longer awaited on every
render of every journal's trip list, only when the journal is empty or
something is broken. The English `problem` is dropped from the page payload,
since the browser renders the translated reason and never reads it.
`missing-fields` now names *which* of title/start/end are wrong rather than
that one of them is, for the same reason `lib/validate/entry.ts` collects every
problem rather than the first. And `add-a-trip` and the agent guide now tell a
writer to read the list back, with a command that was run rather than assumed —
the obvious `node -e` form does not start, for the reason B84 records.

Verified: `npx tsc --noEmit`, `npx eslint .` (0 errors), `npx vitest run` (102
files, 1694 passing), `npm run build`. Beyond the suite, the notice was read off
a running dev server in both English and German, signed in as the owner, with a
`wrecked-trip/` folder seeded into the demo journal — and the same page fetched
with no session contains neither the folder name nor the notice.
