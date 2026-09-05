---
id: B42
title: An entry's time carries no zone, so 09:15 means nothing to a reader in another one
type: FEATURE
priority: medium
complexity: medium
area: entries, ui, feed, docs
found: "2026-09-01"
---

# B42 — An entry's time carries no zone, so 09:15 means nothing to a reader in another one

## Why

An entry may carry `time: "09:15"` (`lib/entries.ts:129`, validated as `HH:mm`
by `lib/validate/entry.ts:114`). The frontend prints that string and nothing
else — `components/StoryPager.tsx:289` renders `{entry.time}` bare, and
`components/SlideShow.tsx:352` joins it into the caption line the same way.

Nowhere is it written down what that string means. It is *intended* to be the
wall clock where the day happened: "first morning in Bangkok, 09:15" is 09:15
in Bangkok. But neither the file nor the skill that writes it says so
(`.claude/skills/add-a-day/SKILL.md:63` documents `time` only as the thing that
"orders several updates within a day"), so an agent writing from a transcript
has no reason not to write the author's home clock, or UTC, or whatever the
photo's EXIF happened to say. Once two entries on one trip disagree about which
clock they mean, sorting is wrong and no later reader can repair it — the
information that would tell them apart was never recorded.

The reader has the same problem from the other end. Family in Zurich reading
"09:15" cannot tell whether that was breakfast or the middle of their own
night. The two facts that make it answerable are already in the entry —
`lat`/`lng` are parsed at `lib/entries.ts:134` — and the browser already knows
the reader's own zone. Nothing joins them.

One place gets it actively wrong today rather than merely silent:
`lib/feed.ts:49` builds the RSS `pubDate` as `` `${date}T${time}:00Z` `` — it
stamps a Bangkok morning as 09:15 **UTC**, seven hours early, and every reader's
feed client sorts and displays it accordingly.

There is prior art in the repo for the mechanism but not for this use:
`timezoneFor()` in `lib/digest/quiet.ts:81` maps a *locale* to a zone band, and
`localHour()` below it deliberately uses `Intl` rather than an offset table
because "the offset of `Europe/Zurich` is not a constant". The same reasoning
applies here and is the reason a stored numeric offset is the wrong fix.

## Work

Three parts, and the first is the one that must not be skipped.

**Write the convention down, then make it enforceable.** `time` is the local
wall clock at the entry's own `location`/`lat`/`lng`, always, with no
exceptions. That sentence belongs in `AGENTS.md` (it is a rule that applies to
every writing path, not one skill), in `.claude/skills/add-a-day/SKILL.md` next
to the field, in the ingest skill where EXIF supplies the time, in
`/agent.md` and in the REST field documentation. Every door that
accepts a `time` should say the same thing in the same words.

**Record the zone rather than infer it forever.** Add an optional `timezone:`
IANA name (`"Asia/Bangkok"`) to the entry frontmatter, resolved once at write
time from `lat`/`lng` and stored, so a reader is never re-deriving it and a
trip that crosses a border does not depend on a lookup table that has since
changed. Absent, fall back to the trip's zone, then the journal's. Do not store
a numeric offset — see `lib/digest/quiet.ts:89`, an offset is not a property of
a place, only of a place at an instant.

**Show both clocks, and only when they differ.** Where the time is rendered
today, show `09:15` with the reader's own equivalent alongside it — the shape
the author asked for is "09:15 local · 04:15 your time". The conversion has to
happen in the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
because the server does not know the reader's zone and must not guess from an
IP; that means the second half arrives after hydration and the markup must be
correct and complete without it. When the two zones agree, print one time — a
reader at home should not be told that 09:15 is 09:15.

Fix `lib/feed.ts:49` in the same change: build the `pubDate` from the entry's
zone, not from `Z`.

**Not doing:** a timezone picker, per-entry manual override in a UI, or any
attempt to re-date the entries already on disk. Existing entries have no
`timezone:` and keep reading exactly as they do now.

## Acceptance

- `AGENTS.md`, `add-a-day`, `ingest-photos`, `/agent.md` and the API field
  documentation all state that `time` is local to the entry's location, in the
  same words.
- An entry with `lat`/`lng` in Bangkok and `time: "09:15"` renders, for a
  browser set to `Europe/Zurich`, both its own time and the reader's; for a
  browser set to `Asia/Bangkok` it renders one time only.
- The page's server-rendered HTML contains the local time and is readable with
  JavaScript disabled; no hydration mismatch warning appears in the console.
- A test fixes `Asia/Bangkok` and asserts the RSS `pubDate` for that entry is
  `02:15 GMT`, not `09:15 GMT` — it fails against `lib/feed.ts:49` today.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` and `npm run build` all
  pass.
