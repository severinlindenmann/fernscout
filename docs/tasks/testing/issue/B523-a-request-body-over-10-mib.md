---
id: B523
title: A request body over 10 MiB is refused as expected_multipart, and the cap is documented nowhere
type: ISSUE
priority: high
complexity: low
area: api, media upload
found: "2026-09-05T21:30:00Z"
started: "2026-09-05T21:20:42Z"
merged: "2026-09-05T21:32:11Z"
---

# B523 — A request body over 10 MiB is refused as expected_multipart, and the cap is documented nowhere

## Why

Reported from a real import: 15 of 75 photographs could not be uploaded at all.
Measured boundary — `10,469,945` bytes → 201, `10,578,068` bytes → 400. That
brackets 10 MiB (10,485,760) exactly.

**Root cause.** This app has a `proxy.ts`, and Next 16 buffers the request body
for a proxied route up to `experimental.proxyClientMaxBodySize`, default
**10MB** (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`).
Past that it does not fail — it *truncates* and logs a warning server-side. The
route then calls `request.formData()`
(`app/api/v1/[user]/trips/[trip]/media/route.ts:165`), which cannot parse a
truncated multipart body, falls into the `catch(() => null)` and answers

```json
{"error": "expected_multipart", "hint": "Content-Type: multipart/form-data …"}
```

Two costs, and the second is the larger:

- **The limit is wrong for the files it is written about.** `IMAGE_MAX_BYTES`
  is 50 MB (`lib/validate/media.ts:24`) and the guide tells an agent to "send
  the largest file you have". An unmodified iPhone 15 original — 5712×4284,
  ~11 MB — is inside every documented limit and cannot be sent.
- **The error names the wrong thing.** `expected_multipart` says *your
  Content-Type is malformed*, so it sends the caller to inspect its own
  request. The reporting run spent three wrong hypotheses and ~15 uploads on
  it. Everywhere else this API refuses by naming the field (`unsupported_field`,
  `method_not_allowed` listing the doors); this is the one place that does not.

## Work

- Raise `experimental.proxyClientMaxBodySize` in `next.config.ts` so a batch of
  the documented size fits. Derive it from `IMAGE_MAX_BYTES` rather than typing
  a second number, and say in the comment that this is buffered in memory —
  which is the reason it is not simply unbounded.
- Refuse honestly *before* parsing. In the media route, read `Content-Length`
  and answer **413** naming the cap and the size received when it is over.
  Keep `expected_multipart` for what it actually means.
- Say the request-body cap in the guide next to the per-image cap — they are
  two different limits and only one is written down
  (`lib/api/agentCopy.ts`, `lib/api/documentation.ts`, `lib/api/openapi.ts`).
  Say the batch arithmetic out loud: a batch is capped by the body, not only by
  `MAX_ITEMS_PER_DAY`.

## Acceptance

- A multipart POST to the media endpoint with a body over the cap answers
  `413` with the cap and the received size in it, not `400 expected_multipart`.
- An 11 MB JPEG uploads and comes back in the day's gallery.
- The guide and `openapi.json` state the request-body cap. A test asserts the
  documented number and the configured one are the same value.
- `npm run verify` green.
