---
id: B03
title: fetchImage re-resolves the hostname after checking it, leaving a rebinding window
type: SECURITY
priority: low
complexity: medium
area: media, ssrf
found: "2026-09-01"
started: "2026-09-04T06:50:26Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:50:26Z"
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

## Work

Pin the address that was checked, rather than checking a name and fetching it:

- resolve once, keep the address, and request it directly with the original
  `Host` header and SNI — or
- pass a custom `lookup` (undici `Agent` / `connect`) that returns only the
  vetted address.

Either way the same option has to survive each redirect hop, since the loop
re-enters with a new URL.

## Acceptance

- A test with a stubbed resolver that answers public once and loopback after
  is refused.
- The existing refusals — http, `file:`, `data:`, literal private addresses,
  `::ffff:127.0.0.1`, redirect chains, oversize bodies — still pass.
