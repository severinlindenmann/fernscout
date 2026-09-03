---
id: B136
title: The size cap is enforced only after the whole body is read, so one URL can hold a connection for a minute
type: ISSUE
priority: medium
complexity: low
area: media, resources
found: "2026-09-03"
started: "2026-09-03T19:14:55Z"
merged: "2026-09-03T19:20:43Z"
---

# B136 — The size cap is enforced after the download, not during it

## Why

Found while verifying B31 on the live instance. B31 passes; this is next to it.

The URL media endpoint takes a caller-supplied URL and enforces a 50 MB cap.

> **Corrected while building.** The paragraph below said the body "is then read
> to completion before the size is judged". That is not what the code did:
> `lib/api/fetchMedia.ts` has checked the running total per chunk and called
> `reader.cancel()` on the way past the limit **since the initial commit**
> (`git log -S 'await reader.cancel()'`). Peak memory was bounded by `maxBytes`
> plus a chunk, not by whatever the remote host chose to send, and the read did
> stop early — nothing asserted it, which is why it was easy to believe
> otherwise.
>
> The measurement below is still real, and still the right complaint. 57.8
> seconds is what it costs to *receive 50 MB* from that host before the cap
> refuses — the cancel happens at the limit, not at 72 MB. So the finding
> survives its own explanation being wrong, and lands on the third Work bullet
> rather than the first: **nothing bounded the read in time.** `TIMEOUT_MS` is
> cleared in the `finally` of the `fetch()` call, before a byte of image has
> been read, so a host that trickles 49 MB passes the byte cap, succeeds, and
> holds a connection and a request handler for as long as it likes. A host that
> sends a little and then stops holds it forever: `read()` on a stalled body
> never settles, and a check between chunks never runs.

The cap is checked against bytes already in hand: the `AbortController` at
`lib/api/fetchMedia.ts:269-282` guards the `fetch()` call — the 15 second
timeout covers getting a response — and the body is read in a loop that stops
at the limit.

Measured on fernscout.ch: a 72 MB Wikimedia JPEG took **57.8 seconds** of
server time before answering `is larger than 50 MB`. The refusal is correct.
The minute spent earning it is the problem.

What that gives a caller who holds a valid agent token:

- A request that occupies a connection and a request handler for as long as the
  remote host is willing to keep sending, bounded only by how fast the bytes
  arrive. A slow server serving 49 MB is worse than a fast one serving 72 MB —
  it succeeds, and takes longer.
- ~~The whole body in memory before anything decides it was too big~~ — see the
  correction above; this one was never true.
- A batch multiplies it. `urls` is a list.

The exposure is bounded: this route needs a write token, so it is not open to
the internet, and a journal's own agent is not the adversary the app is built
against. But the token is exactly what an agent holds, tokens live seven days,
and the URL is by design somebody else's server. "A caller-chosen third party
decides how long we hold a connection" is worth closing on its own terms.

Related but separate: the `Content-Length` header is not a defence, since a
host can lie or omit it. The fix is to stop reading, not to trust a number.

## Work

Bound the read in time as well as in bytes.

- ~~Read the response body as a stream and abort once the accumulated length
  exceeds the limit.~~ Already the case. What was missing is a **test** that
  the read stops early — a version that buffers the whole body and judges it
  at the end passed every test in `test/fetch-media.test.ts`, which is how the
  Why above came to be written. There is now one that counts chunks pulled.
- Keep the wording. `is larger than 50 MB` is the right answer and B31 just
  verified the refusal vocabulary; this changes when it is said, not what.
- Consider a total-time budget for the whole read as a backstop, separate from
  the connect timeout. A host that sends 49 MB at one byte a second passes a
  byte cap and still holds the handler.
- If `Content-Length` is present and already over the limit, refuse before
  reading anything. Cheap, and correct whenever the header is honest.

Not doing: lowering the 50 MB limit. The limit is a product decision about what
a photograph may weigh and it is not what is wrong here.

## Built

- **`BODY_TIMEOUT_MS = 60_000`**, a second clock covering the body once the
  headers have arrived. 60 seconds against a 50 MB ceiling is ~875 KB/s
  sustained; a host slower than that on a file that large is one this endpoint
  declines to wait for. The number is a judgement and is written down as one,
  next to its arithmetic, so it can be argued with.
- Implemented as a **deadline raced against each `read()`**, not a check
  between chunks — the case that costs the most is a host that stops sending,
  and `read()` on a stalled body never settles, so a between-chunks check never
  runs at all. On expiry it aborts the request first (which is what actually
  drops the socket) and cancels the reader second.
- The `AbortController` is **hoisted out of the redirect loop**, because one
  scoped to the loop could only cancel our reader and would leave the
  connection to time out on the remote host's schedule instead of ours.
- **A `content-length` already over the cap refuses before reading**, because
  the only way an overstated header can be wrong is in our favour. It is a
  shortcut to the same answer and explicitly not the check: the existing test
  that hands over 5000 bytes behind `content-length: 4` is what holds that
  line, and still passes.
- The size wording is untouched. The timeout needed new words, and they follow
  B31's convention for a transient refusal: *"took longer than 60 seconds to
  send its body — this may be temporary; send the batch again."*
- `bodyTimeoutMs` is an optional third argument so a test can assert the budget
  without waiting a minute for it. Nothing in the application passes it.

## Acceptance

- A response larger than the cap is refused without the whole body being read —
  asserted by a test that streams more than the limit and observes the read
  stop early.
- A slow response is bounded by a total-time budget, not only by the connect
  timeout.
- The refusal wording is unchanged.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
