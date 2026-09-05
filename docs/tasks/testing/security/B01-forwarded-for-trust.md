---
id: B01
title: X-Forwarded-For is taken on trust, so every rate limit is bypassable
type: SECURITY
priority: high
complexity: low
area: rate-limiting, deploy
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T09:14:24Z"
---

# B01 — `X-Forwarded-For` is taken on trust

## Why

`clientIp()` in `lib/rateLimit.ts:75` reads the **first** value of the header:

```ts
const fwd = req.headers.get("x-forwarded-for");
if (fwd) return fwd.split(",")[0].trim();
```

Caddy's `reverse_proxy` **appends** the real client address to an incoming
`X-Forwarded-For` rather than replacing it. `deploy/Caddyfile` sets no
`header_up` to override that, and nothing in the app declares a trusted proxy.
So a client that sends its own `X-Forwarded-For: 203.0.113.9` puts that value
in first position and `clientIp()` returns it. Rotate the header per request
and every limit keyed on it resets.

Twelve call sites depend on this — every `rateLimitFor()` bucket in `app/api/`,
plus `mcp-auth` in `lib/mcp/http.ts:144`.

What it actually costs:

- **Trip-password guessing.** `app/api/trip-access/route.ts:25` allows 8
  attempts per address per 15 minutes, and its own comment says anything past
  that "is someone working through a word list". Unbounded, in practice.
- **Mail flooding.** `auth/request`, `auth/signup/request` and
  `contacts/request` each send a message per accepted call.
- **Journal creation** — `v1/journals` self-service signup.

Login codes themselves are not affected: `verifyCode()` burns a code after
`MAX_CODE_ATTEMPTS` against the database row, not the address.

There is a second, independent copy of the helper at
`app/api/trip-access/route.ts:15` with the same first-value bug. Both need the
fix, or — better — the route should use the shared one.

## Work

1. Overwrite the header at the edge, in `deploy/Caddyfile`:

   ```
   reverse_proxy 127.0.0.1:3000 {
   	header_up X-Forwarded-For {remote_host}
   }
   ```

2. Delete the duplicate `clientIp` in `app/api/trip-access/route.ts` and import
   the shared one.
3. Say in `lib/rateLimit.ts` that the value is trusted **because** the proxy
   overwrites it, and point at the Caddyfile. Its docstring currently says "as
   seen through nginx", which is left over from before Caddy and is probably
   why this was never re-checked.

Reading the *last* value instead would also work, but only while exactly one
proxy sits in front. Overwriting at the edge stays true if that changes.

## Acceptance

- A request carrying a forged `X-Forwarded-For` is limited on its real address.
  Verify against the deployed site, not only in a test — this is proxy
  behaviour, and a unit test can only assert what the app does with the header
  it is handed.
- One `clientIp` in the codebase, not two.
