---
id: B284
title: A dictionary read that fails for any reason but absence is cached as empty until the file changes
type: ISSUE
priority: low
complexity: low
area: i18n
found: "2026-09-04T12:49:21Z"
started: "2026-09-05T15:05:00Z"
session: e5747799-fd3e-4d40-a335-82fa4e24333e
claimed: "2026-09-05T15:05:00Z"
---

# B284 — A dictionary read that fails for any reason but absence is cached as empty until the file changes

## Why

Found while building B279, and deliberately left there rather than guessed at.

`readDictionary` in `lib/locales.ts` caches its result keyed on the file's stat
signature. B279 made it distinguish a genuinely absent file (ENOENT, expected,
silent) from any other failure (a permission blip, a torn read, malformed JSON
— now `console.warn` naming the file). What it did **not** change is that the
non-ENOENT case still writes an empty dictionary into the cache under the
file's *unchanged* signature. So one worker that hits a transient read failure
serves an empty dictionary for that locale until the file's mtime or size
moves, while every other worker serves it correctly.

That is the leading hypothesis for B279 itself — a page that rendered its own
locale keys to a reader, transiently, on one request, and rendered correct
German a few minutes later with no restart in between. B279's agent could not
reproduce it and correctly declined to claim it as the cause. This capture
exists so the next person has the specific weakness written down rather than
having to rediscover it.

It is low priority for two reasons, and both are worth stating so nobody
mistakes it for urgent. B279 already removed the *harm*: a missing string now
falls through to English and logs, so a stuck-empty dictionary degrades to
readable English rather than to machine text. And nothing has been observed to
trigger it since.

## Work

Do not cache a failure. On any non-ENOENT read or parse error, leave the cache
untouched and return whatever the fallback path already provides, so the next
request retries the file rather than inheriting one bad read for the life of
the process.

Read B279's investigation comment above `readDictionary` first — it records
what was ruled out (B59 recurring, the deploy's content sync) and why, and
repeating that work is the main cost of picking this up.

**The trigger to prioritise this is evidence, not opinion:** if the
`console.warn` B279 added ever fires in production, that is the confirmation
this hypothesis is waiting for, and the ticket becomes worth doing on the spot.
B257's request logging makes that visible where it was not before.

## Acceptance

A dictionary file that fails to read once is read again on the next request,
and a test proves the cache holds no empty entry afterwards.

## What changed

`readDictionary` in `lib/locales.ts` now tracks a local `failed` flag, set
whenever a per-file read or parse throws something other than `ENOENT`. The
`cache.set(...)` call at the end is skipped when `failed` is true — the
function still returns whatever it managed to assemble (the existing
fallback behaviour, unchanged), it just does not memoise that result under
the file's current signature. ENOENT is untouched: it neither sets `failed`
nor logs, so a genuinely absent file is still cached as absent and does not
turn into a per-request stat storm.

## Evidence

- New test in `test/locales.test.ts`: "a transient, non-ENOENT read failure
  is not cached — the next call retries". It injects one `EACCES` throw on a
  `readFileSync` call for an override file (via `vi.spyOn`, restored after one
  throw), with the file's mtime/size never touched between the two
  `dictionaryFor("de")` calls. Confirmed failing against the pre-fix code
  (`git stash` the fix, rerun: `AssertionError: expected 'Karte' to be
  'Sonderkarte'` — the cached-empty override served forever), and passing
  with the fix (second call retries the read and gets the override value).
- `npm run verify` in the worktree: build, `tsc --noEmit`, `eslint .` (0
  errors, 7 pre-existing warnings unrelated to this change), `vitest run`
  (229 files, 3124 passed, 6 skipped — the Postgres-dialect tests, which need
  a running Postgres and are unrelated). All four stages passed.
