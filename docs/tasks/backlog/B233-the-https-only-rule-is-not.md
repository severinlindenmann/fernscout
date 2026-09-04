---
id: B233
title: The https-only rule is not re-applied after a redirect
type: SECURITY
priority: low
complexity: low
area: api, media, ssrf
found: "2026-09-04T07:59:28Z"
---

# B233 — The https-only rule is not re-applied after a redirect

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

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

- Re-check `url.protocol !== "https:"` at the top of each loop iteration, after
  `url = new URL(location, url)`, with the same refusal wording. One line.
- Decide about the port while there. Either restrict to 443 — which is what
  "https only" implies to a reader and what every real image host uses — or say
  in the docstring that any port on a public host is reachable. Restricting is
  the smaller surprise; if it is rejected, the comment has to change instead.
- `pinnedRequest` should not silently ignore a non-https URL. Refusing there as
  well is belt-and-braces, and it is the function a future caller might reach
  directly.

Not doing: the address checks in `checkHost`/`isPublicAddress`, which were
swept and hold (B36, B31, B137), or the two timeouts (B136).

## Acceptance

- `test/sweep-b22-disclosure.test.ts` — the `B233` case flips: the redirect to
  `http://example.com:8080/next.jpg` is refused with the "only https:" wording,
  and the transport is called once rather than twice.
- `test/fetch-media.test.ts` passes unchanged.
- All four checks pass.
