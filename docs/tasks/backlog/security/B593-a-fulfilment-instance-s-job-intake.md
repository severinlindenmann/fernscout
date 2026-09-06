---
id: B593
title: A fulfilment instance's job intake has no admission or rate control
type: SECURITY
priority: medium
complexity: medium
area: self-hosting, postcards, photobook
found: "2026-09-06T14:29:18Z"
---

# B593 — A fulfilment instance's job intake has no admission or rate control

## Why

B590's intake route is, from the fulfilment instance's point of view, an
unauthenticated upload endpoint that any caller can reach — the spec
(`docs/plans/2026-09-06-fulfilment-relay.md`) deliberately leaves open
whether any origin instance may relay to any fulfilment instance, or whether
some lightweight admission (an email-verified relay key, carrying no money,
purely for rate-limiting and for having somebody to write to when a relay is
abused) is needed first. Without it, the fulfilment operator's bandwidth and
disk are spendable by anyone who can reach the route, for jobs nobody will
ever pay for — a cost the spec names but does not resolve.

Depends on B590.

## Work

Decide and build the admission mechanism (a registration step, an
IP/instance-scoped rate limit, or both — this ticket is where that choice
gets made, not the spec) plus rate-limiting on the intake route itself.
Whatever is chosen must not become a payment relationship or a credential
that can spend money — see B492's decision that the money shape is a
per-order link, not an instance-level balance; admission here is strictly an
abuse control.

## Acceptance

An intake route without the admission step refuses uploads; a caller that
exceeds the rate limit is refused with a named reason (matching the
`/api/health` honesty convention elsewhere in this codebase); a security
review (`claude-security`, per AGENTS.md) of the finished route finds no way
to spend the fulfilment operator's storage or money without the admission
step.
