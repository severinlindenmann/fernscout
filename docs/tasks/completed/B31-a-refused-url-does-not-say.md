---
id: B31
title: A refused URL does not say whether the host was checked or the check itself failed
type: ISSUE
priority: low
complexity: low
area: media, fetchMedia
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
completed: "2026-09-03"
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

## What was found while building it

**Splitting the two refusals apart uncovered a live SSRF bypass, and fixing it
had to happen in this task rather than a follow-up.**

`new URL("https://[::1]/…").hostname` keeps its brackets. `net.isIP("[::1]")`
is `0`, so every IPv6 literal skipped the address check entirely and fell
through to `dns.lookup("[::1]")`, which threw, which returned `false`, which
refused the URL. The right answer, by accident, for the wrong reason.

Separating "did not resolve" from "resolved somewhere private" turned that
accident into `[::1]` being answered with *try again* — the wrong thing to tell
somebody probing for loopback. So the brackets had to be stripped. And stripping
them removed the accidental protection, exposing the second bug underneath:

`isPublicAddress` matched IPv4-mapped IPv6 as `::ffff:127.0.0.1`, the spelling a
person writes, while the URL parser normalises to `::ffff:7f00:1`. The hex form
matched no branch and returned `true`. `169.254.169.254` — the cloud metadata
address the check's own comment names — arrives as `::ffff:a9fe:a9fe` and was
public. Four addresses now fail the test suite without the fix, confirmed by
stashing it.

That is why the mapped-address fix is in this commit and not deferred: this
change would otherwise have *introduced* the exposure it had been masking.

The wider question — whether other branches match one spelling while the parser
writes another (`0:0:0:0:0:0:0:1`, `fe90::` link-local, NAT64) — is **B36**, not
absorbed here.

## Acceptance

- A URL whose host resolves into a private range is refused with today's exact
  wording, and a test asserts that string is unchanged.
- A URL whose lookup fails is refused with different, retry-shaped wording.
- Neither reveals an address, a range, or a resolver error.
