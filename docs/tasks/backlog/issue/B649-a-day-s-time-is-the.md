---
id: B649
title: A day's time: is the first file's timestamp, screenshots included, so a day went out stamped 06:44
type: ISSUE
priority: medium
complexity: low
area: helper: icloud-export
found: "2026-09-06T19:33:10Z"
---

# B649 — A day's time: is the first file's timestamp, screenshots included, so a day went out stamped 06:44

## Why

`.claude/skills/icloud-export/build.mjs:99,104` — `const first = list[0]` …
`time: "${first.time}"`.

On the Friday of `elsass-2025` the first file of the day was a screenshot of a
train timetable, taken at **06:44** while planning. The travelling happened
between 14:25 and 16:00. The day went out stamped 06:44, and the person's first
correction was "hier is die uhrzeit wrong".

`time:` orders several updates that share a date, so this is not cosmetic.

Worth understanding on its own: the query step already excludes screenshots from
the *count* it reports ("71 left out: screenshots, videos or not selected"), yet
one was in the export. The two paths do not agree about what a screenshot is.

## Work

A judgement call, and it should not be fixed by guessing. Weakest to strongest:

- Leave it, and have `icloud-export/SKILL.md` tell the agent to check `time:`
  against `notes.md` before writing prose. Cheapest; relies on the agent.
- Skip screenshots when choosing `first`. `osxphotos` knows a screenshot;
  `photos.json` may already carry the flag — **check before assuming**.
- Take the first photograph that *has GPS*, which is the same fallback `lat`/
  `lng` already uses at line 99 (`withGps`). A screenshot has no coordinates.

The third is probably right and is nearly free, since `withGps` is computed on
the same line. Whichever is taken, also settle why a screenshot reached the
export when the count said it was left out.

## Acceptance

A day whose earliest file is a screenshot is stamped with the time of its first
real photograph, and a day of screenshots alone still gets some sensible time
rather than crashing.
