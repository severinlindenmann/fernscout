---
id: B1582
title: health and contentModel never create their cache directory, so a missing one reads as an unreachable server
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, shared/api.mjs
found: "2026-09-12T10:33:49Z"
---

# B1582 — health and contentModel never create their cache directory, so a missing one reads as an unreachable server

## Why

Found while driving B1580, by deleting the cache directory to force a fresh
fetch — which is the obvious thing to do and turns out to break the tools.

`openapi()` in `.claude/skills/shared/api.mjs` starts with
`mkdirSync(CACHE, { recursive: true })`. `health()` and `contentModel()`, which
write into the **same** directory, do not. So all three work as long as
`openapi()` happened to run first and the directory has not been removed —
and when it has, `writeFileSync` throws `ENOENT`, the `catch` around the fetch
swallows it, and `health()` reports:

```
Could not reach http://localhost:3497/api/health and have no usable cached copy:
ENOENT: no such file or directory, open '…/export/.schema/…-health.json'
```

The server was reachable. It had just answered. The message names the errno,
so the truth is recoverable by reading it closely — but the sentence in front
of it is wrong, and it is the sentence a person acts on.

**The quieter half is worse.** `publish.mjs` wraps that call in
`try { … } catch { LIMITS = {} }`, so on this path it loses the instance's
upload limits **in silence** and falls back to a hardcoded 64 MB guess for the
request ceiling. A batch of phone originals sized against a guess is exactly
the failure B540 put those limits in `/api/health` to stop. B1580's own read of
`weather.reservedSources` goes the same way, quietly reverting to a fallback —
that one at least says so out loud, which is what made this visible at all.

## Work

Move `mkdirSync(CACHE, { recursive: true })` so all three readers do it, rather
than adding it twice more — one line, one place, and the directory is the same
one for all of them.

Then look at the `catch` in `publish.mjs`: a failure to read `/api/health`
should say something rather than silently becoming `{}`. B1580's note is the
shape to copy — the run states which answer it is working from.

## Acceptance

- `rm -rf export/.schema` followed by any of the three readers fetches and
  caches without error.
- A genuinely unreachable server still reports that, distinguishably.
- A `publish` run that could not read `/api/health` says so rather than
  proceeding on a guessed request ceiling.
