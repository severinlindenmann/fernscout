---
id: B276
title: Self-service journal creation is open to anyone on fernscout.ch, and B104 records it as never having run
type: SECURITY
priority: high
complexity: low
area: signup, capabilities, ops
found: "2026-09-04T12:25:00Z"
---

# B276 — Self-service journal creation is open to anyone on fernscout.ch, and B104 records it as never having run

## Why

`https://fernscout.ch/api/health` reports `signup: { "enabled": true }` at the
**server** level, and that is the only level the creation flow ever asks about.
All three routes gate on `isEnabled("signup")` with no username —
`app/api/auth/signup/request/route.ts:24`,
`app/api/auth/signup/verify`, and `POST /api/v1/journals`
(`app/api/v1/journals/route.ts:49`) — because there is no journal yet to ask.
There is no allowlist, no invitation requirement and no owner approval anywhere
in that path: `lib/capabilities.ts:25` needs only `SESSION_SECRET` and a
database, and the route additionally needs `mail`, which is on. Rate limiting
(`rateLimitFor("auth-signup", …)`) is the only thing standing between a
stranger and a journal.

Confirmed from outside, with a deliberately invalid address so nothing was
sent:

```
POST https://fernscout.ch/api/auth/signup/request  {"email":"not-an-email"}
202  {"status":"accepted","next":"POST /api/auth/signup/verify …"}
```

**B104 states the opposite**, and its reasoning is where the mistake is: it
reads `/api/health`'s per-journal breakdown — "not enabled by example, by sevi,
by sevi2, by test1" — and concludes the flow "has therefore never run on the
live site". Those per-journal answers are about journal-*scoped* capabilities.
Creating a journal is not scoped to one, so the journal-level switch does not
gate it and never did. B104's Work section also opens with "enable signup for
the journal level the flow needs", which is a step that is not needed and would
find nothing to change.

What it costs to leave alone: names on this instance are a finite,
first-come-first-served namespace with a tombstone that keeps a deleted name
reserved (`lib/tombstones.ts`), each journal is a directory on the VPS disk,
and B92 is already filed for one address owning several journals with no way to
give a name back. An open funnel with four known unfixed defects behind it
(B32, B55, B75/B76, B92) is a different exposure from a closed one.

This is not a claim that the feature is wrong. It is that **nothing in the
repository records the decision to have it open on this instance**, and the one
task that mentions the live state says it is closed.

## Work

The switch already exists — no new capability is needed. `features.signup` in
`content/config.json` (`lib/config.ts:165`, default `false`) is the whole
control, and the server's copy on the VPS is where it is currently `true`.

So the work is a decision and then one of two small changes:

- **Closed** — set `features.signup.enabled` to `false` in the server config on
  the VPS, and the three routes answer `404`, which is the "absent rather than
  broken" rule working as intended. The author creates journals himself; B104's
  walkthrough then needs signup switched on for the duration and off again
  after, which the task should say.
- **Open, deliberately** — leave it on and write down why, plus what bounds it:
  whether an allowlist or invitation is wanted, what happens when a stranger
  hits B32 or B92, and who is on the hook for the disk. That is a bigger piece
  of work and would be its own task; this one only has to get the decision
  recorded.

Either way, **correct B104**: strike the premise that the flow has never run
and the step that says to enable it per journal.

Not doing: building an allowlist, an invitation requirement or a signup quota
here. If the answer is "open with bounds", those are captures of their own.

## Acceptance

- `docs/` records, in prose, whether self-service signup is meant to be open on
  fernscout.ch, and why.
- `/api/health` on the live site agrees with that decision.
- If it is closed: `POST /api/auth/signup/request` on fernscout.ch answers
  `404`, and `POST /api/v1/journals` does too.
- B104's Why no longer claims the flow has never run, and its Work no longer
  begins by enabling a journal-level switch that does not gate it.
