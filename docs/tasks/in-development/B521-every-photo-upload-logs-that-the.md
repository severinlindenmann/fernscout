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
