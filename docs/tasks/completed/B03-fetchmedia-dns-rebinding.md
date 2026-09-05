---
id: B03
title: fetchImage re-resolves the hostname after checking it, leaving a rebinding window
type: SECURITY
priority: low
complexity: medium
area: media, ssrf
found: "2026-09-01"
started: "2026-09-04T06:50:26Z"
merged: "2026-09-04T07:42:56Z"
completed: "2026-09-05T09:30:17Z"
---

# B03 — A DNS rebinding window in `fetchImage`

## Why

`lib/api/fetchMedia.ts` is careful, and deliberately so: https only, manual
redirect following, every hop re-checked, IPv4-mapped IPv6 handled, the size
cap enforced while reading rather than from `Content-Length`. It is a better
SSRF guard than most.

One gap remains, in the ordering:

```ts
if (!(await resolvesPublicly(url.hostname))) return refuse(...);
// ...
response = await fetch(url, { redirect: "manual", ... });
```

`resolvesPublicly()` does its own `dns.lookup`. `fetch()` then resolves the
hostname **again**, independently. A name whose first answer is public and
whose second is `127.0.0.1` passes the check and is then fetched at the private
address — the classic time-of-check/time-of-use rebind.

The module's own comment says the ordering defeats this, and it does defeat it
*across redirects* — a hop cannot launder a private address past the check.
Within a single hop it does not, because the check and the request are two
separate resolutions.

Why this is low and not high: it needs an agent token with write scope on a
trip, so the caller is someone the owner has already trusted with the journal;
it needs control of an authoritative nameserver with a very low TTL; and the
result is a fetch whose body must pass an `image/*` content-type check before
anything is stored. It is a real hole in a real defence, not an open door.

## What changed since this was written

Two things, and one of them changes the Why.

**B137 landed in this file first.** `checkHost` now returns four verdicts
rather than three — `nonexistent` was split out of `unresolvable` — and the
refusal wording was reworked. None of that touched the ordering this task is
about, and B31's rule still holds and still holds after this change: no
refusal names an address, a range, `ENOTFOUND`, `EAI_*` or any resolver detail.

**The remedy the Work section offered first does not work.** "Resolve once,
keep the address, and request it directly with the original `Host` header and
SNI" cannot be done with `fetch`: Node's `fetch` takes neither a `lookup` nor a
`servername`, and rewriting the URL to the IP would make TLS verify the
certificate against an address rather than against the name — trading a
rebinding window for no certificate check at all. The second option was the
right one, with one correction: `undici` is not a dependency of this project
and Node does not export its `Agent`, so there is no dispatcher to hand
`fetch`. `node:https` takes a `lookup` directly and needs nothing installed.

## Work

`lib/api/fetchMedia.ts` no longer uses `fetch`.

- `checkHost` returns `{ verdict, addresses }`. The addresses are the ones it
  actually inspected, and they are empty for every verdict but `public`.
- `pinnedLookup(addresses)` is a resolver that has already made up its mind: it
  ignores the hostname it is handed and never consults DNS, so there is no
  second answer to differ from the first.
- `pinnedRequest` makes the request with `node:https`, passing that lookup, and
  wraps the `IncomingMessage` back into a `Response` so the reading code above
  it is untouched — the size cap, the two clocks and the content-type check are
  the part of this file that has been got right twice already (B31, B136).
- TLS still verifies against the *name*: `servername` carries the original
  hostname into SNI and certificate validation. Pinning changes where the
  packets go, not who has to prove they are the host. An IP literal gets no
  `servername`, because TLS rejects one.
- Redirects are unchanged in behaviour and stronger in kind: `https.request`
  has no redirect logic at all, so "manual" is no longer an option that could
  be set wrongly. Each hop is re-checked *and* re-pinned to its own answer.
- The abort signal now reaches the socket, so the response and body timeouts
  let go of the connection rather than only of our reader.

**A `transport` parameter** was added alongside the two existing overridable
timeouts, for the same reason and with the same rule: nothing in the
application passes it. The tests that stub a remote host stub it instead of
`globalThis.fetch`, which is no longer called.

Not doing: adding `undici` as a dependency, or a global DNS cache.

## Acceptance

**A stubbed resolver that answers public once and loopback after is refused.**
`test/fetch-media.test.ts`, "is connected to at the address that was checked,
and nowhere else". It is driven end to end rather than through a spy: a real
`net` server on loopback stands in for the attacker's target, `node:dns/promises`
(what the check consults) answers `203.0.113.9`, and `node:dns` (what
`net.connect` consults) answers `127.0.0.1`. The test asserts the second
resolver was never called, that nothing landed on the decoy, and that the
result is a refusal.

Against the code as it stood it fails on the first of those:

```
AssertionError: the hostname was resolved again at connect time:
expected 1 to be +0
```

**The existing refusals still pass** — 94 cases in `test/fetch-media.test.ts`,
including http, `file:`, `data:`, every private-address spelling, the bracketed
IPv6 literals, redirect chains into private space, redirect loops, oversize
bodies, both timeouts, and the wording rules from B31 and B137. Two of them
were rewritten rather than deleted, and both kept their intent:

- "asks fetch not to follow redirects itself" asserted `redirect: "manual"` on
  a `fetch` init that no longer exists. It is now "every hop is a request this
  code makes itself, at that hop's own URL", which is the property that
  assertion stood for, plus a new sibling asserting each hop carries its own
  addresses.
- `test/media-url-upload.test.ts` stubs `https.request` instead of
  `globalThis.fetch`, which leaves *more* of the real code under test than
  before: the pin included.

**And it works against a real host.** Smoke-tested outside the suite, since the
build never touches the network: `https://www.google.com/favicon.ico` returns
5430 bytes with the filename derived, and `https://google.com/favicon.ico` —
which redirects — returns the same, so a hop is followed, re-checked and
re-pinned.
