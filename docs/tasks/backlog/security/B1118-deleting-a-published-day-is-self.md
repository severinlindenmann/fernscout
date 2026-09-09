---
id: B1118
title: Deleting a published day is self-serviced by the agent, unlike every other unrecoverable delete
type: SECURITY
priority: high
complexity: low
area: api, agentConfirm, deletion
found: "2026-09-09T17:35:34Z"
---

# B1118 — Deleting a published day is self-serviced by the agent, unlike every other unrecoverable delete

## Why

Found under B101, the live grey-box engagement, against a local instance
(`docs/security/2026-09-09-live-engagement.md`). Reproduced against a running
server, not just read.

`DELETE /api/v1/<user>/trips/<trip>/days` — `app/api/v1/[user]/trips/[trip]/days/route.ts:272-333` —
removes a day's entry file, published or not, behind `lib/agentConfirm.ts`: a
five-minute HMAC code the same request/response round trip requests and then
consumes. No human sees it. No mailbox is involved.

That is the right shape for a draft, which nobody but the owner has ever read.
It is the wrong shape for a **published** day, and the project's own doctrine
says so, in the ticket that trimmed the confirmation off *publishing*:

> Deletion keeps its confirmation and should. Deletion is unrecoverable and
> its second step happens in a mailbox (`lib/deletions.ts`, B38); publishing
> is reversible by putting the line back.
> — B224 (completed, 2026-09-04)

That sentence is the reasoning for why trip deletion and journal deletion both
mail a single-use link to the owner and finish nothing until a human clicks a
button on a page (`lib/deletions.ts`, `app/api/v1/[user]/deletions/[token]/route.ts`).
Deleting a published day is the same shape of harm — content somebody's family
has already read, linked, or received by mail, gone in one request — and it
gets the *weaker* protection: a code the calling agent itself requests, reads
out of its own response, and immediately replays. Nothing stops a compromised
agent, an over-eager one, or a trip-scoped collaborator's own agent from
deciding on its own that a published day should go, asking itself for
permission, and getting it.

The route's own comment is also stale and says the opposite of what the code
does:

> "Only drafts. A published day is somebody's family reading about a place
> they went; removing one is a person's job, with `rm`, in a folder they own."
> — `app/api/v1/[user]/trips/[trip]/days/route.ts:269-270`

The code two lines below computes `operation.action` as `delete_published`
specifically for this case and answers with a harsher warning string — it
plainly expects to be called this way, and is.

**Reproduction**, against the local instance booted for B101 (`example`
journal, capabilities `auth`/`mail` on):

1. Publish a day: `POST /api/v1/example/trips/alps-2024/days` then
   `.../a-test-day/publish` with an owner-scoped agent token
   (`write:content`). Confirm it is live: `GET /example/trips/alps-2024/day/a-test-day` → `200`.
2. `DELETE /api/v1/example/trips/alps-2024/days` with `{"slug":"a-test-day"}`
   and the same bearer token → `409 confirmation_required`, body includes
   `"confirm":"cf_mtudoc81_…"` and `"action":"delete_published"` in the
   operation it signs.
3. Repeat the same `DELETE` with `{"slug":"a-test-day","confirm":"cf_mtudoc81_…"}`
   → `200 {"ok":true,"deleted":true,"published":true,...}`.
4. `GET /example/trips/alps-2024/day/a-test-day` → `404`.

Three HTTP requests, no mailbox, no human, and the entry file — the record
that the day was ever published — is gone. (The photographs are kept on
disk, which is the one thing the response is honest about.)

## Work

Not a code change here — B101 does not fix, only finds. A follow-up ticket
through `open/` should decide the shape, but the doctrine in B224 already
points at it: route `delete_published` through the same mailbox confirmation
`lib/deletions.ts` uses for a trip or a journal, or something equivalent —
not `lib/agentConfirm.ts`, which B224 kept *specifically* for the case where a
self-served round trip is an acceptable guarantee (deletion of a draft nobody
else has read). `delete_draft` can keep the current handshake unchanged; it
is `delete_published` alone that is the wrong shape. The stale comment at
`app/api/v1/[user]/trips/[trip]/days/route.ts:269-270` should be corrected or
removed either way, since it currently asserts a restriction the code does
not enforce.

## Acceptance

- A fix ticket exists (or this one is promoted) that requires a published
  day's deletion to go through a step no bearer-token holder can complete
  alone — a mailbox link, an owner-cookie-only confirmation, or equivalent —
  while leaving draft deletion's existing single-round-trip confirmation
  unchanged.
- The stale "Only drafts" comment is corrected to describe what the code
  actually does.
