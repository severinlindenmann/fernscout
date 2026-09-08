---
id: B760
title: A mapped statement cannot offer the exchange rates a known one can
type: ISSUE
priority: low
complexity: low
area: agent, costs
found: "2026-09-07T13:57:56Z"
started: "2026-09-08T20:52:47Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:52:47Z"
---

# B760 — A mapped statement cannot offer the exchange rates a known one can

## Why

`lib/statements/read.ts:213` derives `rates` for `trip.md` from the `charged`
pairs a known bank's export carries — what the bank actually charged in the
home currency against what the merchant billed. That is the honest exchange
rate for a trip, better than any published one.

A statement read through the new column mapping (B689) has one amount column,
so `charged` is never populated and that offer simply is not there. Nothing
says so; a person who imported a mapped CSV just never sees rates offered and
does not know they missed anything.

## Work

Either a second amount column in the mapping (the billed amount beside the
charged one), or a sentence on the screen saying rates are only available for
the banks with a dedicated importer, and which those are.

## Acceptance

Somebody importing a mapped statement knows whether rates were available and
why not.
