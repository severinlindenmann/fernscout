---
id: B690
title: POST /api/v1/<user>/import: dryRun flag on costs import has no effect and response does not say so
type: ISSUE
priority: medium
complexity: low
area: API
found: "2026-09-07T09:54:25Z"
---

# B690 — POST /api/v1/<user>/import: dryRun flag on costs import has no effect and response does not say so

## Why

The API accepts a `dryRun: true` flag on costs imports, but costs imports never write anything to disk anyway — a statement is analyzed and reported, and what each line was for remains an editorial decision left to the owner. Since the costs import is read-only by design, the `dryRun` flag is meaningless. A caller sending it gets no indication of that. They see a `200` response and reasonably conclude their import was a no-op when it was a full read of all transactions.

This violates the contract principle: a field the API accepts must appear in the response, or an agent cannot verify its own work.

## Work

Either remove the `dryRun` parameter from the costs import schema (since it has no effect), or document in the response why the flag is accepted and ignored. Clarify that costs imports are read-only and do not write regardless of `dryRun`.

Do not add a `dryRun` implementation for costs — that would be inventing a decision (what categories each transaction belonged to) that belongs to the owner.

## Acceptance

The `/openapi.json` schema for `POST /api/v1/<user>/import` (costs variant) no longer names `dryRun`, or the response documentation states that the flag is accepted but has no effect on a costs import. The test in `test/openapi-contract.test.ts` passes.
