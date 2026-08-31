# W08 — Email OTP auth (simulated in dev)

**Roadmap:** C3, C12 · **Depends on:** W06, W07 · **Wave E**

## Goal
A reader proves an email address with a 6-digit code and stays logged in for
months. No external auth service. Fully testable with no mail account.

## Decision: hand-rolled over Better Auth
The roadmap named Better Auth. For what this actually needs — email OTP, a
session cookie, no OAuth, no passwords, no orgs — a library is more surface than
substance, and it would own the schema that W06 deliberately controls.
**Implement OTP directly**; revisit if passkeys or social login are ever wanted.

## Scope
- `POST /api/auth/request` → email + rate limit → 6-digit code, hashed, 10 min TTL
- `POST /api/auth/verify` → code → session (httpOnly, Secure, SameSite=Lax, 90d)
- **Dev simulation**: with `AUTH_DEV_MODE=1` the code is printed to the console
  *and* written to `./mail/`. `AUTH_DEV_CODE=123456` fixes it for E2E tests.
- Rate limiting on both endpoints (`lib/rateLimit.ts` exists) — per email and
  per IP. This endpoint is the abuse surface.
- Double opt-in (C12) shares the same code path.
- Sessions in DB (W06), revocable, listed in the admin surface (W10).

## Security notes
- Codes: constant-time compare, single use, invalidate siblings on success
- Max 5 attempts per code, then burn it
- Never reveal whether an address is known — same response either way
- Log verification failures; they're the signal that matters

## Acceptance
- [ ] `auth.enabled=false` → routes 404, no session code runs
- [ ] Full login flow works end to end with **no mail account** (file transport)
- [ ] Wrong code 5× burns it; correct code afterwards fails
- [ ] Session survives restart, expires on schedule, revocation works immediately
- [ ] Rate limit provably blocks a loop
