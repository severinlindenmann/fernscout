---
id: B1459
title: Journal creation sends a next pointer the contract never mentions
type: ISSUE
priority: low
complexity: low
area: agent docs, routes
found: "2026-09-11T12:46:38Z"
started: "2026-09-11T14:10:10Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T14:10:10Z"
---

# B1459 — Journal creation sends a next pointer the contract never mentions

## Why

Found by checking B311 against the deployed instance rather than against its
own report.

B311 made three routes point a caller at the skill document for the next step,
via `skillDocPath()`. All three do it in code:

- `app/api/v1/journals/route.ts:627` → `/skill/add-a-trip.md`
- `app/api/v1/[user]/trips/route.ts:212` → `/skill/add-a-day.md`
- `app/api/v1/[user]/trips/[trip]/days/route.ts:259` → `/skill/ingest-photos.md`

**Two of the three are described in the contract. The first is not.** Live on
fernscout.ch, the `201` for `POST /api/v1/{user}/trips` says *"`next` names the
call that writes the first day and links the skill document for it (B311)"*, and
`POST /api/v1/{user}/trips/{trip}/days` says *"`next` points at the photographs
skill document"*. `POST /api/v1/journals`'s `201` — `lib/api/openapi.ts:1891` —
describes `signIn`, `signInNote`, `url` and `localesNote`, and never mentions
`next` at all.

That is the exact failure AGENTS.md names: *"A field the code accepts and the
document does not describe is a field nobody outside will ever use."* And it
lands on the **first** call in the sequence, so an agent creating a journal is
the one caller least likely to learn that the pointers exist at all.

The test B311 wrote (`test/skill-docs.test.ts`) catches a pointer aimed at a
404. It does not catch a pointer nobody documented, which is why this survived a
green suite.

## Work

Add the sentence to `lib/api/journals`' `201` description in
`lib/api/openapi.ts`, in the voice the other two use.

Then close the class rather than the instance: `test/openapi-contract.test.ts`
already fails on an undocumented route+verb. Consider asserting that a route
whose handler calls `skillDocPath()` has a response description mentioning
`next` — the three call sites are findable by the same walk
`test/skill-docs.test.ts` already does over `app/api`.

This is small enough to fold into another worktree's work rather than take a
branch of its own.

## Acceptance

- `POST /api/v1/journals`'s `201` description names its `next` pointer.
- A route that sends a skill-document pointer and does not document it fails a
  test.
- `npm run verify` clean.
