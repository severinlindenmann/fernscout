---
id: B859
title: Nothing proves a refused journal creation leaves no journal behind
type: CHORE
priority: low
complexity: low
area: api, journals, tests
found: "2026-09-07T17:11:06Z"
started: "2026-09-08T05:35:44Z"
merged: "2026-09-08T05:39:57Z"
completed: "2026-09-09T16:47:49Z"
---

# B859 — Nothing proves a refused journal creation leaves no journal behind

## Why

A tester reported that `POST /api/v1/journals` refused for a missing
`baseCurrency` **and still created the journal and spent the signup token**.

Reading the route, that should not be possible: the currency checks return at
`app/api/v1/journals/route.ts:~289`, well before `createJournal` at `:354`, and
the file's own doc comment says a signup token survives a refused creation
"deliberately and in writing". The likelier explanation is that a later call in
her sequence succeeded and the one after it was the retry that met
`invalid_token`.

So this is probably not a bug — and "probably" is the problem. B839 has just
made `baseCurrency` required, which adds a new refusal in front of a route
whose whole contract is *one token, one journal*. A wrong answer here costs
somebody their only signup token and leaves a half-made journal with a
permanent currency.

## Work

A test, not a fix: refuse a creation for each reason the route can refuse —
missing currency, bad currency, `displayCurrencies` without the base, a taken
username — and assert after each that no journal exists and the token is still
spendable. Then create successfully with the same token to prove it.

Cheap, and it turns an ambiguous report into a guarantee.

## Acceptance

Every refusal path is covered, and each one leaves nothing behind.

## Outcome

`test/journals-refusal-leaves-nothing.test.ts`. Nine refusals — missing or bad
`baseCurrency`, `displayCurrencies` without the base, missing `visibility`,
`defaultLocale`, `title` and `ownerName`, a reserved name and a malformed one —
each asserted to leave no journal in the cache and no folder on disk, followed
by a taken-name 409 (the one refusal that comes from inside `createJournal`),
and then the same token spent successfully and refused a second time.

The report does not reproduce: nothing is created and nothing is spent on any
refusal path. Two small facts the test pinned down while proving it — a
reserved username answers `400`, not `409`, and a refused clash leaves the
existing journal's owner untouched.
