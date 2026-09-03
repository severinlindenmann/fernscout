---
id: B119
title: Two days in one trip can take the same slug, and the second becomes unreachable
type: ISSUE
priority: medium
complexity: low
area: api, entries, docs
found: "2026-09-03"
started: "2026-09-03"
---

# B119 — Two days in one trip can take the same slug

## Why

Found while verifying B77 on the live instance. B77 itself passes in full: one
`slugify`, one rule, twenty transliteration cases correct through REST, MCP and
ingest alike. This is the case on the other side of it.

Two different titles can legitimately produce the same slug. `Đà Lạt` (U+0110,
d-with-stroke) and `Ðà Lạt` (U+00D0, eth) both become `da-lat`, and that
mapping is deliberate — `lib/slug.ts` folds `[đĐðÐ]` to `d` on purpose. The
same happens for any two titles differing only in punctuation or diacritics.

The API accepts both into one trip without complaint:

```
POST …/trips/b77-slug-umlaut/days  {"title":"Đà Lạt","date":"2026-01-11"} -> 201 slug "da-lat"
POST …/trips/b77-slug-umlaut/days  {"title":"Ðà Lạt","date":"2026-01-12"} -> 201 slug "da-lat"
```

Both files are written — `2026-01-11-da-lat.md` and `2026-01-12-da-lat.md` are
both on disk. But only one can be addressed:

```
GET …/trips/b77-slug-umlaut/days/da-lat   -> the 2026-01-11 day, always
```

The second day exists, is not a draft, and cannot be reached by its permalink.
Nothing told the writer. The `201` said it worked and handed back a slug that
already belonged to something else.

`/agent.md` states plainly that **"a slug is unique within a trip"**. That is
the contract an agent writes against, and it is not true. So the failure is
worse than a collision: an agent that reads the guide has no reason to check,
and the day it just wrote for somebody is quietly unreachable. This is content
loss of the recoverable kind — the file is there — but the person is told the
day is on their site, and its URL shows a different day.

B77 explicitly scoped out anything touching existing slugs, which is why this
was left rather than folded in. It is small and it is separable.

## Work

Decide which of the two promises to keep, then keep it.

- **Refuse the write.** A `409` naming the day that already holds the slug,
  with the existing day's date, so the caller can pick a different title. This
  matches how a taken username is handled and keeps `/agent.md`'s sentence true.
- **Or disambiguate.** `da-lat-2` and a slug in the reply that differs from what
  the caller might have predicted — which is fine, because the reply is already
  the authority on what the slug is.

The first is probably right: two days in one trip with titles that differ only
by an invisible codepoint is more likely a mistake than an intention, and
silently renaming somebody's permalink has its own surprise. Either way the
caller must be told, and `/agent.md` must say what actually happens.

Check the same question for **trip ids** within a journal while in there. The
username path answers `409 username_taken`; whether two trips can collide the
same way is unverified.

Not doing: changing the transliteration. Folding `đ` and `ð` to `d` is correct
and B77 settled it.

## What was found while building it

The Why held exactly, reproduced locally in one call: `slugify("Đà Lạt")` and
`slugify("Ðà Lạt")` both return `da-lat`.

**Refused, as the Work section leaned.** `createDraft` now answers with the
file that already holds the slug, and the REST route's existing prefix match
turns that into a `409` rather than a `400` — the request was well-formed; the
trip's contents are what make it impossible. Both doors write through
`createDraft`, so MCP gets the same answer for free. Renaming to `da-lat-2` was
the alternative and stays rejected: it would hand somebody a permalink they did
not choose and could not predict, to fix what is almost always a typo.

**The narrow check that was there is kept.** `fs.existsSync` on the exact
`date-slug.md` still answers first, with its old wording, because an agent
retrying a dropped request should be told it found its own earlier write rather
than a stranger's collision. The new check is the general case behind it.

**A draft holds a slug as firmly as a published day.** The check reads the
directory rather than `getAllEntries`, which filters drafts out — and a draft
holding the slug is exactly as much of a conflict, since publishing it later is
the moment the shadow would appear. That is also the worst moment to find out.

**Six copies of one rule, now one.** The "strip `.md`, strip the date prefix"
derivation existed five times in `lib/api/entries.ts` and once in
`lib/entries.ts`, and the collision check would have been the seventh. It is
`entrySlugFromFile` in `lib/entries.ts` now. A rule about *identity* that
disagrees with itself in one file is how a day becomes reachable down one code
path and not another, which is this task.

**Trip ids, the neighbouring question, are already safe** — and structurally,
not by a check somebody remembered. A trip id is supplied by the caller and
validated, never derived from a title, so there is no folding step for two
inputs to survive; and the id is the directory name, which the filesystem will
not issue twice. `createTrip` refuses a taken one with `trip_exists` → `409`.
Pinned in the test file rather than left as a note.

**Ingest has the same defect and is not fixed here — see B141.** Its naming
loop keys `usedSlugs` on `${date}/${slug}`, so the same town on two different
days collides exactly as the API did. It needs the opposite remedy: ingest is a
batch import and must not refuse, and it *deliberately* joins an existing entry
for the same date. A different decision, so a separate task rather than scope
absorbed quietly.

## Acceptance

- Writing a day whose slug already exists in that trip either fails with a
  clear error naming the conflict, or succeeds with a distinct slug — not
  silently shadowed either way.
- The same through REST and MCP, since both doors write days.
- `/agent.md` describes the real behaviour; if uniqueness is enforced, the
  existing sentence stands, and if slugs are disambiguated, it is corrected.
- A test writes two titles that slug identically and asserts both days remain
  addressable, or that the second was refused.

### Evidence

- **Refused, clearly.** `test/slug-collision.test.ts` writes `Đà Lạt` then
  `Ðà Lạt` on a later date: the second is refused, the error names
  `2026-01-11-da-lat.md`, one file is on disk, and `getAllEntries` returns one
  slug. Also asserted while the holder is still a draft, and after it is
  published.
- **Both doors.** `test/mcp.test.ts` drives MCP `create_day` and the REST
  route: the tool errors naming the slug and the file, and REST answers `409`
  after a `201` for the first day. A genuinely different title still writes.
- **`/agent.md` describes the real behaviour.** The existing "a slug is unique
  within a trip" sentence stands and is now true; a paragraph under the day
  fields says what happens on collision and why two titles collide.
- **Not silently shadowed either way**, and nothing else regressed: 104 files,
  1713 passing. Six of the new assertions fail against the previous code,
  confirmed by stashing `lib/` and re-running.

`npx tsc --noEmit`, `npx eslint .` (0 errors), `npx vitest run` and
`npm run build` all pass.
