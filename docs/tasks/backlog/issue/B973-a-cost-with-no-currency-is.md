---
id: B973
title: A cost with no currency is filed in the base one without anybody being asked
type: ISSUE
priority: low
complexity: low
area: helper, costs
found: "2026-09-08T13:59:03Z"
---

# B973 — A cost with no currency is filed in the base one without anybody being asked

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

*"We spent 15 on the museum"* produced a proposal with `currency: ""`, and the
route accepted it and filed it in the journal's base currency without saying
so.

Defaulting is right — `lib/costs.ts` has always read a cost with no currency as
base, and every entry written before multi-currency existed depends on it. What
is missing is that nobody was told. On a trip where the base is CHF and the
person is standing in Portugal saying "fifteen", the guess is wrong half the
time, and it is wrong in a way that shows up much later as a total that feels
about right.

Found beside B960 and B959, which are the same subject from the other end: the
totals are now honest about what they *could not* convert, and this is money
quietly converted by assumption instead.

## Work

Probably the card rather than the route. `currency` is a field on the proposal;
opening it on the journal's base currency — visible, editable, with the trip's
own currencies as options where there are any — makes the assumption something
a person sees before pressing rather than after.

Not doing: refusing a cost with no currency. That would break every existing
day and would be a worse answer than a visible default.

## Acceptance

A cost proposed without a currency shows which one it will be filed in, before
the press.
