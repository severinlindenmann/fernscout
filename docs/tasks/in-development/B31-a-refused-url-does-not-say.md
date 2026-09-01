---
id: B31
title: A refused URL does not say whether the host was checked or the check itself failed
type: ISSUE
priority: low
complexity: low
area: media, fetchMedia
found: "2026-09-01"
started: "2026-09-01"
---

# B31 — A refused URL does not say whether the host was checked or the check itself failed

## Why

`resolvesPublicly` in `lib/api/fetchMedia.ts:124` gates every URL fetch, and one
failure answers for two different things. A hostname that resolves to a private
range and a hostname that could not be resolved at all — DNS timeout, transient
SERVFAIL, a resolver that is briefly unhappy — both come back as
`that host does not resolve to a public address`.

For the private case that wording is deliberate and should not change: the
comment above it says so, and it is right. A prober must not get to map
somebody's network one hostname at a time, so every private answer reads alike.

But a *transient resolver failure* is not that. It is "try again", and an agent
told "does not resolve to a public address" reads it as "this URL is
permanently unusable", drops the image and moves on — or worse, tells the person
their photo host is blocked. The all-or-nothing batch rule makes it louder:
one flaky lookup discards a whole upload, and the reply explains it in words
that say the batch will never work.

The related observation from the same run: `picsum.photos` answers `HEAD` with
`405`, which is a normal way to pre-flight a URL before handing it over. That is
not a bug here — this endpoint does not send `HEAD` — but it is why agents
pre-flight at all, and it is the same class of confusion: a check that failed
being read as a subject that failed.

## Work

- Separate "checked, and it is private" from "could not check" inside
  `resolvesPublicly`, and give the second its own refusal wording that says to
  retry. The first keeps the words it has, unchanged and uniform.
- Do not leak which range, which resolver, or how it failed. The distinction to
  expose is only permanent-versus-transient.
- One line in `agent.md` beside the https/public-hosts rule: what a retryable
  refusal looks like, so an agent knows the batch is worth sending again.

Not doing: retrying inside `fetchImage`. The all-or-nothing contract already
tells the caller to resend the batch, and a silent internal retry makes a slow
endpoint slower without telling anyone why.

## Acceptance

- A URL whose host resolves into a private range is refused with today's exact
  wording, and a test asserts that string is unchanged.
- A URL whose lookup fails is refused with different, retry-shaped wording.
- Neither reveals an address, a range, or a resolver error.
