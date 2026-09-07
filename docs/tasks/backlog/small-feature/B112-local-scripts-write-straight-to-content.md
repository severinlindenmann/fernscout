---
id: B112
title: Local scripts still write straight to content, and the one guarantee they skip is the draft rule
type: FEATURE
priority: medium
complexity: medium
area: scripts, api, security
found: "2026-09-03"
---

# B112 — Local scripts still write straight to content, and the one guarantee they skip is the draft rule

> **Rewritten 2026-09-07.** This was captured as an open architectural fork
> asking for a plan that picked between three directions. Two years of a
> fortnight later, events have picked for it: the direction taken was **close
> the door where a network path exists, keep it where one does not, and unify
> the writer.** What is left is smaller and more concrete than the original
> ticket, which is now the record and not the work. The original is kept below
> the line.

## Why

The person's instruction, while fixing B84, was: *"get rid of `npm run ingest`,
make sure all requests have to go through the API — no direct local access with
functions like that."* The concern is that a write through `/api/v1` carries a
token, lands as `status: draft` with no flag able to skip it, is rate-limited
and cannot publish without a separate owner-only call — and a local script
writing into `content/<user>/` has none of that.

**Most of the door has since been closed, by tasks that never referenced this
one:**

- **B298** removed MCP, so there is one network door rather than two.
- **B510** moved the instance's own four files to `site/`, so nothing but
  user content is written under `content/` at all.
- **B671** deleted the location-history CLI outright and made
  `POST /api/v1/<user>/import` the only way in, with the reasoning this ticket
  was asking for: *"a hosted journal's owner has no shell on the server and an
  agent never has one, so a capability reachable only by `npm run` was
  unreachable by both."*
- **B677** did the same for a bank statement.

So the fork is decided in practice, and the third option — split by kind — is
what the codebase now does. What has never been done is the part that made the
first option worth having: **one validated writer that every path goes
through.** `lib/tripWrite.ts` is that writer for the API. Whether the remaining
local scripts use it, and whether any of them can still write a published or
invalid day, is unknown and is the question this ticket should now answer.

## Work

- **Inventory, first and cheaply.** List every script under `scripts/` that
  writes into `content/`, and for each say whether it goes through
  `lib/tripWrite.ts` or writes its own frontmatter. That list is the finding;
  it may be that nothing is left and this closes with a test.
- **For each one that writes its own:** route it through the shared writer so
  the draft rule and the field validation hold on both doors, or delete it if
  a network route now covers it (the B671 precedent).
- **A test that keeps it true.** The shape B671 left behind is the model: an
  assertion about the import graph is worth more than a paragraph. Something
  that fails if a file under `scripts/` writes an entry without going through
  the validated writer.
- **Name what stays, and say why in a comment.** Ingest is offline by design —
  `scripts/ingest.ts`'s header is explicit that the evening you most want to
  write up the day is the evening the wifi does not work — and the `migrate:*`
  one-off operator scripts are not content writes in the ordinary sense. Build
  tooling (`build:mapdata`, `build:geodata`, `update-rates`, `tasks`) is not
  the target and must not be swept up.

Explicitly not doing: removing offline ingest, or making `content/` anything
other than an operator-editable folder. The premise of the project is a folder
the author owns; the guarantee being defended is the draft rule, not the
absence of local writes.

## Acceptance

- No script under `scripts/` can write a day with `status: published`, or with
  a field the API would refuse.
- A test asserts it, rather than a paragraph.
- Offline ingest still works with no server running, and the inventory says in
  one line why each surviving script survives.

---

## The original capture, 2026-09-03

Kept as the record of the fork before it was decided by events. It asked for a
plan in `docs/plans/` choosing between: keep both doors and unify the
guarantee; close the repo door entirely and expose each capability through the
API; or split by kind, sending content writes through the authenticated path
and leaving build tooling alone. It noted that ingest is offline by design and
that `content/` is meant to be operator-editable, and that neither could be
assumed away. Related: **B84** (the ingest fix that surfaced this), decision 24
and the "one rule" in `AGENTS.md`, **B89** (credits).

**Note (B298):** MCP was removed 2026-09-04. The quoted instruction above is
the record of what was actually said and stays as written; "the network path"
means the REST API alone.
