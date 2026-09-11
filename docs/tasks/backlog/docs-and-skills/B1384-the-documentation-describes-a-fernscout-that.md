---
id: B1384
title: The documentation describes a Fernscout that no longer exists
type: DOCS
priority: medium
complexity: high
area: docs, onboarding, guests, hosting, contributing, api, agent.md
found: "2026-09-10T19:15:50Z"
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

## Pass, 2026-09-11 — the nine skill documents and `/documentation.txt`

Read `lib/api/documentation.ts` and `lib/api/skillDocs.ts` in full against the
current route table (`lib/api/openapi.ts`, `app/api/**`) and the tickets that
moved fastest in the last two days (B311, B909, B1045, B1053, B1092, B1157,
B1295, B1428, B1459). Two real corrections came out of it; everything else
checked against the code was already right.

**Fixed — `## Printing a photobook` described a route B1428 deleted.** The
section (and the `make-a-photobook` skill doc it feeds) still walked an agent
through `GET .../postcards/recipients` then `POST
/api/v1/<user>/photobooks/<id>/print` with a `contactId` body, quoting a
`quotedCredits` reply. That route is gone: B1157 made buying a photobook one
page and one press on the owner's own trip page, and B1428 (2026-09-11)
deleted the legacy `printOrder` path and its route file
(`app/api/v1/[user]/photobooks/[id]/print/route.ts`) along with the operation
in `openapi.ts`, explicitly calling out `/agent.md` as a place that must not
still describe it — which, because B311 landed the same day, actually meant
this file. The only route left under `/api/v1/{user}/photobooks/{id}` is `GET`,
and its own doc comment says so: *"there is no agent-facing proposal call for
this to read back any more (B1428 deleted the pre-B1157 one)."* Rewrote the
section to say there is nothing to propose, point the owner at
`/<user>/trips/<trip-id>/photobook` to build and buy it themselves, and keep
only the `GET` for reading back where an order stands. Updated
`SKILL_DOC_SUMMARY["make-a-photobook"]` in `lib/api/skillDocMeta.ts` to match —
it still said "propose printing a book."

**Fixed — two owner-facing prompts still called `/agent.md` "the full
guide."** `handoverPrompt` and `buddyPrompt` in `lib/api/agentCopy.ts` (used by
`components/AgentHandover.tsx` and `components/BuddyHandover.tsx`, so real text
an owner pastes into an agent) each had a step reading `The full guide is at
${siteUrl}/agent.md`. Since B311 that path is a bare 301 to
`/documentation.txt`; calling it "the full guide" is exactly the class of
sentence the decision on this ticket named. Repointed both at
`${siteUrl}/documentation.txt` and described it as the index it now is
(pointing into the task guides it links), rather than a document in itself.

**Checked and left alone**, because the document was already right and it was
worth confirming rather than assuming:

- `/agent.md` retiring to a 301 — already described correctly in the "A web
  helper exists too" section (never called "the guide" there).
- `costs` becoming operator-only (B1092) — the config example only ever
  toggles `contacts`, and nothing in these documents claims a journal's own
  `config.json` can turn `costs` on or off.
- The helper sending one area's tools per turn (B1053) — that is internal to
  `/agent`'s own implementation; the network-facing documents already say the
  helper's routes are "outside this document on purpose" and never described
  its tool registry to begin with, so there was nothing to correct.
- `PUT .../trips/<trip-id>/plan` (B909) — already present, in the trip's
  planned-route section.
- `GET .../trips/<trip-id>/tracks` vs `GET .../trips/<trip-id>` carrying
  `tracks` — both already correctly distinguished.
- The `/<user>/export.zip` (bearer token) vs `/<user>/export/<token>` (mailed
  link, B1295) split — the document only ever describes the former, which is
  correct: `app/[user]/me/export/route.ts` explicitly refuses an
  `Authorization` header and tells the caller to use `/export.zip` instead, so
  the mailed-link door is deliberately not an agent's to use and rightly
  absent from these documents.
- The `next` pointer's presence on the three replies B311/B1459 named —
  already there (`journals`, `trips`, `days`), and `test/skill-docs.test.ts`
  now fails the whole class if a future route drops it, so not re-verified
  line by line.
- `/api/health` saying less to an unauthenticated caller (B1045) — that
  changed `app/api/health/route.ts` and `openapi.ts`'s description of it, not
  prose in these documents, which only ever point at `/api/health` for the
  reader to check for themselves rather than restating its shape.
- The full route table in `openapi.ts` diffed against every `/api/v1/...`
  path mentioned in `documentation.ts`: no other renamed, added or retired
  route found.

**Byte sizes.** `agentGuide()` (the source every skill document and
`/documentation.txt` render from): under this session's edit, 149,105 bytes
against the 146 KiB (149,504-byte) ceiling in `test/agent-interface.test.ts` —
before this edit (same generator, same environment, everything else held
constant) it was 149,804, so the photobook rewrite trimmed it by 699 bytes,
not the other way round. `/skill/add-a-day.md` is untouched by this pass and
still clears its 10,240-byte ceiling by 82 bytes, exactly as the brief said.

`npm run verify`: all 5 steps passed — 534 test files, 6978 passed, 4 skipped.

**Left outside this pass, on purpose:** the wider `docs/` sweep and
`AGENTS.md`, per the decision above — untouched.
