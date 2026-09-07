---
id: B521
title: every photo upload logs that the body was truncated at 10MB
type: ISSUE
priority: medium
complexity: low
area: media upload, proxy, next config
found: "2026-09-05T21:12:00Z"
started: "2026-09-07T11:06:00Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:06:00Z"
---

# B521 — every photo upload logs that the body was truncated at 10MB

## Why

Thirty-three times between 23:01 and 23:04:55 on 2026-09-05, uploading to
`severin/algarve-2026`:

```
Request body exceeded 10MB for /api/v1/severin/trips/algarve-2026/media.
Only the first 10MB will be available unless configured. See
https://nextjs.org/docs/app/api-reference/config/next-config-js/middlewareClientMaxBodySize
```

One line per photograph. The sentence says data was dropped.

**The photographs that landed are intact** — all 33 derivatives are valid
progressive JPEGs at full dimensions (1500×2000 and friends), checked with
`file`. So the warning is about what `proxy.ts` sees, not about what the route
receives: Next caps the body a *middleware* may read at 10MB and says so, and
the route handler reads the stream itself. Nothing is corrupt.

That is the whole problem. A warning that says "only the first 10MB will be
available" on every single upload is either true — in which case photographs
are being silently truncated and nobody has noticed because the derivatives
happen to decode — or false, in which case it is thirty-three lines of noise
per trip teaching the next reader to skim the log. Both are worth one hour.

`lib/validate/media.ts` and `site/config.json`'s `media` block are where the
real limit is declared; `next.config.ts` is where
`middlewareClientMaxBodySize` would go.

## Work

Find out which it is, first, and write the answer down:

1. Upload one file **larger than 10MB** and compare the bytes that reach the
   route against the bytes on disk before the resize. If they match, the
   warning is noise from the middleware and the fix is to raise
   `middlewareClientMaxBodySize` to the media limit — or to keep `proxy.ts`
   off this route entirely, which is cheaper if it does nothing there.
2. If they do not match, this is a data-loss bug and the priority is wrong:
   raise it, and check whether anything already uploaded is affected.

Either way the log line has to stop appearing on a normal upload. A limit that
is deliberately 10MB should be *refused* with a clear error, not accepted and
warned about.

## Acceptance

- Uploading a file at and above the configured media limit produces no
  `Request body exceeded` line.
- A file over the limit is refused with the error `lib/validate/media.ts`
  defines, not silently accepted.
- The task file records which of the two cases it was, with the byte
  comparison that decided it.

## Triage

This is the same incident as B523 (`docs/tasks/testing/issue/B523-a-request-body-over-10-mib.md`),
found twenty minutes apart on the same night — B521 at 21:12Z, B523 at
21:30Z, merged at 21:32Z (`a91615aa`, `ea86e8fb`) — almost certainly two
sessions independently noticing the same upload run. B523 did the byte
comparison this ticket's Work section asks for and answered case 1: the
bytes that reach the route match the bytes on disk (nothing is corrupt); the
warning was noise from `proxy.ts`'s buffering, which Next 16 calls
`experimental.proxyClientMaxBodySize` (the option this task's Why section
names by its pre-rename spelling, `middlewareClientMaxBodySize` — confirmed
against `node_modules/next/dist/docs/01-app/03-api-reference/05-config/
01-next-config-js/proxyClientMaxBodySize.md`, since AGENTS.md warns this
project's Next config surface is not the one a model remembers).

`next.config.ts` already sets `experimental.proxyClientMaxBodySize:
REQUEST_MAX_BYTES` (512 MiB, from `lib/validate/media.ts:106`) — derived
from the same constant the media validator enforces, not a second number, as
B523's Work section asked. `REQUEST_MAX_BYTES` already exceeds
`IMAGE_MAX_BYTES` (50 MB) and `VIDEO_MAX_BYTES` (500 MB) with room for
multipart framing, so a normal upload — even the largest a validator will
accept — is well inside the proxy's buffer and never triggers Next's
truncation warning. A body genuinely over the media limit is refused by
`app/api/v1/[user]/trips/[trip]/media/route.ts` with a `413` naming the cap
and the size received (B523's other half), not by Next's buffer silently
truncating it — so this ticket's "refuse with the error lib/validate/media.ts
defines, not silently accept" is met too. `test/media-body-limit.test.ts`
covers this (asserting the configured `proxyClientMaxBodySize` against
`REQUEST_MAX_BYTES` and against the documented cap).

No code change made here — B523 already is the fix, and pre-dates this
worktree by weeks. Superseding note: this ticket's Work is fully covered by
B523's diff; nothing further to build.
