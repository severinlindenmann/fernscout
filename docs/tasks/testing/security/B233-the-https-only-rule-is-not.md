---
id: B233
title: The https-only rule is not re-applied after a redirect
type: SECURITY
priority: low
complexity: low
area: api, media, ssrf
found: "2026-09-04T07:59:28Z"
started: "2026-09-04T08:08:58Z"
merged: "2026-09-04T08:43:24Z"
---

# B233 — The https-only rule is not re-applied after a redirect

## Why

`lib/api/fetchMedia.ts` states its own rules at the top of the file, and the
first is:

> - **https only.** No http, no file:, no gopher:, no data:.

It is enforced once, at `fetchImage`, *before* the redirect loop:

```ts
if (url.protocol !== "https:") {
  return refuse("only https: URLs are fetched — http, file and data are refused");
}
let response: Response;
for (;;) { ... url = new URL(location, url); continue; }
```

Inside the loop the next hop is re-resolved and re-pinned — that is B03's fix
and it holds, and it is the half that matters. What is not re-asked is the
scheme and the port. `pinnedRequest` then builds its request from
`url.pathname`, `url.search` and `url.port || 443` and ignores `url.protocol`
entirely, so a `302` to `http://host:8080/x` produces a **TLS connection to
port 8080** on that host.

What this is not: an internal SSRF. `checkHost` still runs on the redirect
target, so every private, loopback, link-local, NAT64 and v4-mapped range is
still refused, and `dns.lookup("")` returns no addresses so `file:`, `data:`
and friends land on the `nonexistent` branch. The pin means the socket goes
where the check looked.

What it is: the documented rule is not the enforced rule, and the residual
capability is a caller-chosen **port** on a caller-chosen **public** host —
reached over TLS, so a non-TLS service just fails the handshake and the timing
of that failure is the signal. Low, and worth closing because the gap between
the comment and the code is the thing that gets inherited by whoever edits this
next.

Found by the B22 sweep; see `docs/security/2026-09-04-sweep.md`.

## Work

**Done.** The check moved *into* the redirect loop in `lib/api/fetchMedia.ts`,
as the first thing asked about every hop — before the hop is resolved, since a
scheme this file will not speak is not a reason to send anybody's resolver a
name. It is now one named function, `httpsOnlyProblem`, so the rule has a place
to be documented rather than being a bare condition. `pinnedRequest` asks it
too and rejects: that function is the one that opens the socket, and it would
otherwise happily build `url.port || 443` out of an `http:` URL a future caller
handed it directly.

**The port was considered and deliberately not restricted, and the file now
says so** — which is the alternative this ticket named ("if it is rejected, the
comment has to change instead"). Two things decided it:

- It removes a real capability. A self-hoster whose photographs sit on `:8443`
  has a legitimate URL this endpoint would stop fetching, and
  `test/fetch-media.test.ts`'s B03 pin test — the most valuable test in the
  file, which drives a real socket against a decoy listener — **cannot be
  written at all** under a 443-only rule, because it needs an ephemeral port.
  That test failing was the evidence, not a nuisance to work around.
- It buys nothing *here*. `fetchImage` is called with a URL the agent chose, so
  following a redirect reaches no port the original URL could not have named
  directly. The port question is orthogonal to this ticket rather than part of
  it.

So the residual capability is stated in the docstring instead of implied by the
word "https": a caller-chosen port on a caller-chosen **public** host, over
TLS, bounded by `checkHost`, which is unchanged.

Not done: the address checks in `checkHost`/`isPublicAddress` (B36, B31, B137),
or the two timeouts (B136).

## Acceptance

`test/sweep-b22-disclosure.test.ts` was flipped. Its B233 block now asserts:

- a `302` to `http://example.com:8080/next.jpg` is refused with the "only
  https:" wording, and **the transport is called once**, not twice — before,
  the second call received a URL with `protocol === "http:"` and `port ===
  "8080"` and `pinnedRequest` opened TLS to 8080;
- a redirect that stays on https is still followed, and lands on the second
  host;
- a redirect to https on another port is followed **deliberately**, with the
  reasoning above written into the test, so the documented rule and the
  enforced rule are asserted to agree in both directions;
- `http://…` supplied directly is refused, unchanged.

`test/fetch-media.test.ts` passes unchanged — 94 tests, including the B03 pin
test against a real listener.

There is no HTTP surface to curl for this one: `fetchImage` is reached only
through `POST /api/v1/<user>/trips/<trip>/media` with an agent token, and the
reproduction needs a redirecting host. The transport seam is the reproduction,
which is what it exists for.

`npm run build`, `npx tsc --noEmit`, `npx eslint .` and `npx vitest run` all
pass: 138 files, 2165 tests, 3 skipped.
