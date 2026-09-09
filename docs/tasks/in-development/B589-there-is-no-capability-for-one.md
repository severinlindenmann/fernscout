---
id: B589
title: There is no capability for one instance to fulfil another's print jobs
type: FEATURE
priority: medium
complexity: medium
area: self-hosting, capabilities
found: "2026-09-06T14:28:58Z"
started: "2026-09-09T04:55:59Z"
session: eef381a2-5a19-477a-a5ce-5f4f2d3dacab
claimed: "2026-09-09T04:55:59Z"
---

# B589 — There is no capability for one instance to fulfil another's print jobs

## Why

B492 designed a relay so an instance with no printer account and no payment
provider can hand a finished photobook or postcard job to an instance that
has both (see `docs/plans/2026-09-06-fulfilment-relay.md`). Nothing in
`lib/capabilities.ts` yet distinguishes "this instance may send a job
elsewhere" from "this instance will accept one" — both are new, both must be
off by default, and they are independent of each other (an instance can relay
out, accept in, both, or neither).

## Work

Add a `fulfilment` feature to `FEATURE_NAMES`/`lib/config.ts` with two halves,
per the spec:

- `relay`: this instance may hand a job to another. Needs one config value —
  which fulfilment instance to use — and no secret (see the spec's answer to
  "no accounts, no API keys on the self-hoster's box").
- `accept`: this instance will take jobs from others. Requires
  `postcards`/`photobook` to be enabled with a **real** provider (not
  `dry-run` — see B588/`dryRunNote()`) plus a real payment method; accepting
  into a `dry-run` provider relays nothing that was not already possible
  locally, so `resolveOne` should refuse it the same way a missing env var is
  refused.

`/api/health` reports both halves like every other capability, with a reason
when off. **Not doing:** the intake route, the relay client, or any protocol
— this ticket is the switch and its honesty, matching how B588 landed for
the dry-run note.

## Acceptance

`resolveCapabilities().fulfilment` (or the shape chosen) reports `relay` and
`accept` independently; `accept` is refused with a named reason when the
underlying print provider is `dry-run` or has no payment method configured;
a test in `test/capabilities.test.ts` covers both halves off, on, and refused.
