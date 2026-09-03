---
id: B136
title: The size cap is enforced only after the whole body is read, so one URL can hold a connection for a minute
type: ISSUE
priority: medium
complexity: low
area: media, resources
found: "2026-09-03"
started: "2026-09-03T19:14:55Z"
session: d3574848-24a5-45ec-90ce-a52b8c8fe222
claimed: "2026-09-03T19:14:55Z"
---

# B136 — The size cap is enforced after the download, not during it

## Why

Found while verifying B31 on the live instance. B31 passes; this is next to it.

The URL media endpoint takes a caller-supplied URL and enforces a 50 MB cap.
The cap is checked against bytes already in hand: the `AbortController` at
`lib/api/fetchMedia.ts:269-282` guards the `fetch()` call — the 15 second
timeout covers getting a response — and the body is then read to completion at
`:310-320` before the size is judged.

Measured on fernscout.ch: a 72 MB Wikimedia JPEG took **57.8 seconds** of
server time before answering `is larger than 50 MB`. The refusal is correct.
The minute spent earning it is the problem.

What that gives a caller who holds a valid agent token:

- A request that occupies a connection and a request handler for as long as the
  remote host is willing to keep sending, bounded only by how fast the bytes
  arrive. A slow server serving 49 MB is worse than a fast one serving 72 MB —
  it succeeds, and takes longer.
- The whole body in memory before anything decides it was too big, so the peak
  cost of a refused upload is the full size of what was sent.
- A batch multiplies both. `urls` is a list.

The exposure is bounded: this route needs a write token, so it is not open to
the internet, and a journal's own agent is not the adversary the app is built
against. But the token is exactly what an agent holds, tokens live seven days,
and the URL is by design somebody else's server. "A caller-chosen third party
decides how long we hold a connection" is worth closing on its own terms.

Related but separate: the `Content-Length` header is not a defence, since a
host can lie or omit it. The fix is to stop reading, not to trust a number.

## Work

Enforce the cap while streaming, not after.

- Read the response body as a stream and abort once the accumulated length
  exceeds the limit. The existing `AbortController` can carry this — it just
  needs to fire on bytes as well as on time.
- Keep the wording. `is larger than 50 MB` is the right answer and B31 just
  verified the refusal vocabulary; this changes when it is said, not what.
- Consider a total-time budget for the whole read as a backstop, separate from
  the connect timeout. A host that sends 49 MB at one byte a second passes a
  byte cap and still holds the handler.
- If `Content-Length` is present and already over the limit, refuse before
  reading anything. Cheap, and correct whenever the header is honest.

Not doing: lowering the 50 MB limit. The limit is a product decision about what
a photograph may weigh and it is not what is wrong here.

## Acceptance

- A response larger than the cap is refused without the whole body being read —
  asserted by a test that streams more than the limit and observes the read
  stop early.
- A slow response is bounded by a total-time budget, not only by the connect
  timeout.
- The refusal wording is unchanged.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
