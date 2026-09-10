---
id: B592
title: A relayed job's status never flows back to the instance that sent it
type: FEATURE
priority: medium
complexity: medium
area: self-hosting, postcards, photobook
found: "2026-09-06T14:29:13Z"
wontDo: Part of the fulfilment relay chain, which is not being built. See B590.
---

# B592 — A relayed job's status never flows back to the instance that sent it

## Why

Once B591 hands a job to a fulfilment instance (B490's route, B590), the
origin instance's own page has no way to learn whether it was ever paid for,
printed, or failed. `lib/postcard/send.ts`'s own comment about a `202` for
deletion is the model to follow: a job handed off is "a preview is waiting"
or "paid, printing", never "sent", until the fulfilment instance actually
confirms it. Without this, an origin instance's UI can only ever say "handed
off" forever, which is not honest once money or paper has actually moved.

Depends on B590 and B591.

## Work

A status callback (webhook the fulfilment instance calls, or a poll the
origin instance owns — either satisfies the requirement, the choice is an
implementation detail this ticket should settle) so the origin instance's own
record of the job updates to `paid`/`printed`/`failed` as the fulfilment
instance's own order does. The origin instance's page reflects only what it
has been told, never advancing past "handed off" on its own.

## Acceptance

A fixture fulfilment instance (or a mocked callback) reports `paid` then
`printed` for a relayed job, and the origin instance's own status for that
job advances to match; before any callback arrives, the origin instance never
reports more than "handed off, awaiting payment".
