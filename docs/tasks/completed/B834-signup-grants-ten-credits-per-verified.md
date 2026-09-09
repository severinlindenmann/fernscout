---
id: B834
title: Signup grants ten credits per verified email with no per-identity cap, so credits can be farmed with disposable inboxes
type: ISSUE
priority: medium
complexity: medium
area: credits, signup, abuse
found: "2026-09-07T16:01:36Z"
started: "2026-09-08T21:36:19Z"
merged: "2026-09-08T21:56:42Z"
completed: "2026-09-09T16:46:38Z"
---

# B834 — Signup grants ten credits per verified email with no per-identity cap, so credits can be farmed with disposable inboxes

## Why

**Validated against the code as it stands on 2026-09-08 — the hole is real,
though narrower than the title first suggests.**

`app/api/v1/journals/route.ts` grants `SIGNUP_CREDIT_GRANT` (10,
`lib/credits.ts:375`) once per created journal. Two caps already existed
before this ticket and both still hold:

- `MAX_JOURNALS_PER_EMAIL = 1` (`lib/journals.ts:123`) — one journal per
  verified email address, for ever. This is B92's "one per email" already
  done (its own file is stale on that point — see the capture filed below).
- `CREATED = { max: 5, windowMs: HOUR }` (`app/api/v1/journals/route.ts:35`)
  — five successful journal creations per hour, keyed by the caller's network
  address (`clientIp`).

Neither caps *farming*. The email cap is per-address and a disposable inbox
is free to make a new address; the hourly cap resets every hour, so an
address that simply waits out each window can create five journals an hour
**forever** — 120/day, indefinitely — each one minting another ten credits.
`test/signup-credit-grant.test.ts` even documents the shape of the exposure:
its own harness gives every call a fresh IP specifically to stay under the
hourly cap. There was no daily, weekly or lifetime ceiling on one address at
all — that is the "no per-identity cap" the title names.

**The exposure is bounded, not open-ended — see the note below, unedited
from when this was filed.** The ten credits cannot reach anyone else; the
only things farmed credits buy are `helper`, `transcription` and the
farmer's own `storage`, roughly CHF 2 of the operator's Anthropic/Deepgram
budget per verified address. What was missing was a ceiling on how many
addresses' worth of that one *network address* could mint in a day, which
is the piece a script running unattended from one machine actually hits.

**What this ticket does not decide, because it is not a code question:**
whether to also cap by something more persistent than an IP (a device, a
card on file, anything that survives a new inbox *and* a new IP) is a
product trade against locking out real shared connections — a hostel, a
campus, a carrier-grade NAT — and the ticket explicitly rules out a
captcha, a fingerprint or a third-party reputation check as the way to get
there. That decision is left to a person; see "Left open" below.

## Work

Added a second budget on the same event `CREATED` already governs
(successful journal creation), rather than a new mechanism: `CREATED_DAILY
= { max: 15, windowMs: 24 * HOUR }` in `app/api/v1/journals/route.ts`,
checked and spent alongside the existing hourly `CREATED` budget, keyed the
same way (by `clientIp`, via the existing `rateLimitFor`/`rateLimitStatus`
helpers in `lib/rateLimit.ts` — no new tracking, no fingerprinting).

This does not close the hole against a farmer holding many network
addresses — nothing short of the product decision above does — but it turns
"unlimited over time from one address" into "150 credits a day from one
address," which is the actual shape of the cheapest attack (one script, one
machine, a stream of disposable inboxes).

`tooMany()` gained a third `reason` (`journals_created_daily`) so the 429
still says which budget ran out and for how long, rather than reusing the
hourly message's "last hour" wording for a daily refusal.

**Not done, and why:** a per-identity cap beyond the network address (see
"Left open"); a captcha, device fingerprint or reputation service
(explicitly out of scope per the ticket); changing `SIGNUP_CREDIT_GRANT`
itself, `MAX_JOURNALS_PER_EMAIL`, or the hourly `CREATED` budget, none of
which this ticket found reason to touch.

## Left open — a person's call

Whether a persistent, non-fingerprinting per-identity cap is worth building
at all, and if so what "identity" should mean here beyond a network address
(nothing in this codebase currently proves anything more durable than the
email itself, which is exactly what is disposable). Options, roughly in
order of how much they change the product:

1. **Do nothing further** — the daily IP cap above plus the existing bounded
   exposure (CHF ~2/address, no spam vector) may simply be an acceptable
   risk for this instance's scale, as the original note below already
   argued before this ticket added any code.
2. **Lower `SIGNUP_CREDIT_GRANT` or raise the price of `helper`/
   `transcription`** so the ceiling on what a farmed credit buys drops
   further, without touching the signup flow at all.
3. **Require something costlier to mint than an email** before a grant is
   paid out (a phone number, a card with no charge, a longer wait) — a real
   product change to the signup flow, weighed against B681/B682's whole
   point that somebody with no agent of their own must still be able to
   start a journal with nothing but an address.

None of these were picked here; (1) is effectively the status quo, (2) and
(3) both change what signing up costs a legitimate first-time owner and are
not this ticket's to decide.

## Acceptance

- `npx vitest run test/journals-daily-rate-limit.test.ts` — new test,
  fails before this change (no daily budget existed) and passes after:
  an address that creates 5 journals, waits out the hourly window, and
  repeats twice more (15 total) is refused a 16th with
  `reason: "journals_created_daily"`, even though the hourly budget has
  just reset.
- The same file's second test: an honest, first-time signup from a fresh
  address still gets a `201` and its `SIGNUP_CREDIT_GRANT` credits —
  the new cap does not touch anyone who isn't already near either budget.
- `test/journals-rate-limit.test.ts` and `test/signup-credit-grant.test.ts`
  (the existing coverage for the hourly cap and the grant itself) still
  pass unchanged.
- `npm run verify`.

## Bounded exposure (why this is low)

The ten credits cannot reach anyone. `day_mail`, `day_whatsapp`, `digest` and
`postcard` only ever go to a journal's own approved, opted-in contacts, and a
farmed journal has none — so there is no spam vector. The only spends a farmer
can actually consume are `helper` (one model write-up) and `transcription`
(audio→text), both self-serve, plus `storage` (their own disk). So the whole
prize is roughly CHF 2 of the operator's Anthropic/Deepgram budget per
verified email address. Worth a per-identity cap eventually; not a launch
blocker, and not an abuse path against other people.
