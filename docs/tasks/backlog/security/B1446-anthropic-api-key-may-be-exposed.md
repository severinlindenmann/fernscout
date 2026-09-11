---
id: B1446
title: Anthropic API key may be exposed and needs rotation
type: SECURITY
priority: high
complexity: low
area: vps, secrets
found: "2026-09-11T11:32:31Z"
---

# B1446 — Anthropic API key may be exposed and needs rotation

## Why

The user believes the live `ANTHROPIC_API_KEY` used by fernscout.ch may have
been exposed. A leaked key can be used to run inference on the owner's
account until it is revoked, so it needs replacing rather than just watching.

## Work

- Generate a new Anthropic API key in the console and revoke the old one.
- Update the key on the VPS (env file the app reads it from — see
  `get-a-credential`/`vps` skills for where secrets live on the box) and
  restart the app so it picks up the new value.
- Confirm nothing else on the box or in any `.env`/deploy script still has
  the old key hardcoded.
- Not in scope: rotating any other secret (Stripe, mail, etc.) unless the
  same exposure also touched those.

## Acceptance

- Old key shows revoked/inactive in the Anthropic console.
- `/api/health` (or an actual model call through the app) works with the new
  key in place on the VPS.
- `grep` for the old key's value across the VPS env files and this repo
  turns up nothing.

## Retyped OPS → SECURITY, 2026-09-11

Found by B675, which publishes a roadmap page filtered on `type: SECURITY`.
This ticket was typed `OPS`, so **its title would have rendered to the public**:
*"Anthropic API key may be exposed and needs rotation."*

Publishing that sentence is itself a hint, whether or not the key was ever
exposed. But the retype is right on the merits regardless of the page: a
credential that may be in somebody else's hands is a security finding, not an
operations chore. `OPS` in this repository means an engagement against the
running instance whose deliverable is findings; this is a thing to fix.

The filing follows the type, so it moves to `backlog/security/` and is now
caught by both halves of the roadmap filter — the folder check and the
frontmatter check.
