---
id: B1384
title: The documentation describes a Fernscout that no longer exists
type: DOCS
priority: medium
complexity: high
area: docs, onboarding, guests, hosting, contributing, api, agent.md
found: "2026-09-10T19:15:50Z"
started: "2026-09-11T04:33:25Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T04:33:25Z"
---

# B1384 — The documentation describes a Fernscout that no longer exists

## Why

The documentation was written early and the product has moved a long way since.
Whole capabilities that did not exist when it was written — the guided web
helper at `/agent`, the identity cookie, buddy and guest invites, credits and
Stripe, postcards and photobooks, the inbox, GPS tracks, the importers, the
`/admin` page — are either absent from it or described as they were planned
rather than as they shipped. A reader following it today is being told about a
Fernscout that no longer exists.

The four areas the author named, all of them stale:

- **Onboarding** — how somebody gets a journal at all, from landing page to
  first published day. It is the path most likely to be read and the one least
  likely to still be right.
- **Guests** — the whole access vocabulary changed. `private` / `public` /
  `guest` on a trip, `public` / `guest` on a journal, `listed:`, `teaser:`,
  per-photograph visibility, buddy links versus guest links, and the approval
  queue that is the only thing that ever creates a grant. This is the part
  where being wrong is a privacy problem rather than an inconvenience.
- **Hosting** — self-hosting an instance: `site/config.json` versus
  `FERNSCOUT_CONFIG`, `DATA_DIR` and `CONTENT_DIR`, which capabilities are off
  by default and what each needs, mail, backups, the rates refresh.
- **Contributing** — how work is actually done here: tasks, worktrees,
  `npm run verify`, skills.
- **API** — reading and writing over the network. `/openapi.json` is generated
  and true; the prose around it is not necessarily.
- **Inhalte erstellen** — writing a day, a trip, photographs, costs, a plan.
  Since there is no CMS by decision, this is the only description of how content
  gets made, and it has to cover both an agent in a checkout and a person
  talking to the helper.

`docs/README.md` already says most of `docs/` was written by an agent during the
build and never read line by line by a person. This is the ticket that changes
that.

## Work

Read every page under `docs/` against the code as it is today and rewrite it —
a rewrite, not a patch. Restructure where the structure is the problem: the
current tree grew by accretion and the reader-facing pages are mixed in with
operational notes.

In scope, per the author: **everything a human or an agent reads.** That is
`docs/` in full, `/agent.md` (the network guide), and `AGENTS.md`. Verify each
claim against the code before keeping it; fix the document rather than
recording the discrepancy.

Not in scope: `docs/plans/`, which is intent as written before the work and is
deliberately never corrected to match what shipped. Leave those alone.

Where a page turns out to describe something that is genuinely missing rather
than merely undocumented, capture that as its own backlog task and reference it
by id — do not absorb the build into this ticket.

Expect this to produce a handful of follow-up captures. It is a fortnight.

## Acceptance

- Every page under `docs/` (excluding `docs/plans/`) has been read against the
  code and either rewritten, corrected, or deleted as superseded.
- Onboarding, guests, hosting, contributing, API and content creation each have
  a page that a person who has never seen Fernscout can follow start to finish
  without hitting an instruction that does not work.
- The guest/visibility page states the current vocabulary correctly, including
  that `private` on a trip and `guest` on a journal mean different things.
- `/agent.md` and `AGENTS.md` reviewed in the same pass; nothing in either
  names a file, route or field that no longer exists.
- `docs/README.md`'s caveat about unread agent-written prose is either removed
  or narrowed to whatever is still true.
- `npm run verify` passes (docs changes can still break `knip` and the link
  checks).


## Decision, 2026-09-11 — do the pass B311 was blocking, and stop there

B311 landed today, so the reason this was held is gone: `/agent.md` is now a 301
to `/documentation.txt`, and the guide is nine `/skill/<task>.md` documents plus
that index.

**Scope for this session: the network-facing documents only.** Correct what an
agent reads — the nine skill documents and `/documentation.txt` — so nothing in
them names a route, a field or a file that no longer exists.

Deliberately **not** in this session: the wider `docs/` sweep and `AGENTS.md`.
Its own estimate was a fortnight of reading, and `AGENTS.md` changed four times
today alone (B1046, B1141, B1297, and B311's own reference updates). A
correctness pass over a file that is moving that fast is a pass that is stale
before it merges.
