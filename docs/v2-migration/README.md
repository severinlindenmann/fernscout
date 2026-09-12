# The v2 migration — orchestrator's handoff

You are the agent orchestrating the complete migration of this app from the
v1 API to v2. The concept, contract, plan and first two phases were done in
the session of 2026-09-12 (ticket B1587). This folder is your whole brief:
read it top to bottom before doing anything, then follow `03-build-order.md`
step by step and keep `05-status.md` true as you go.

## What this is

A clean-slate API redesign, decided field by field with the owner. The goal
is stated in one sentence: **as little legacy as possible** — v1 is deleted
area by area as v2 replaces it, the content becomes canonical v2 (via a
replay migration), and nothing survives because it was easier to keep.

## Where things stand (as of 2026-09-12)

- **Phase 0 — golden contract: DONE.** The Zod schemas in
  `lib/api/v2/schemas/` are the frozen spec (30 tests in
  `test/api-v2-schemas.test.ts`). The generated OpenAPI (125 operations)
  and the six area contracts are in `docs/plans/2026-09-12-api-v2/`.
- **Phase 1 — door locked: DONE.** fernscout.ch is invite-only ALPHA:
  signup disabled, banner set (in FERNSCOUT_CONFIG on the VPS; the
  pre-alpha config is backed up on the server). Breaking the live instance
  mid-build is an inconvenience for two people, not an incident.
- **Phase 2 — the build: NOT STARTED.** That is your job. Order and gates
  in `03-build-order.md`.

## The files here

| File | What |
|---|---|
| `00-decisions.md` | Every decision the owner made, by id — the law of this migration. Do not re-litigate; new questions go to the owner. |
| `01-golden-contract.md` | Where the contract lives and the design rules every route must follow. |
| `02-plan.md` | The clean-cut plan: phases, gates, what "no legacy" means. |
| `03-build-order.md` | Phase 2, step by step: build → validate locally → deploy → validate live. Your working script. |
| `04-instruments.md` | The verification instruments that do not trust an agent's claim — build them early, use them at every gate. |
| `05-status.md` | The living log. Update it after every step; the next session (or a person) reads it first. |

## Non-negotiables, inherited from AGENTS.md and the owner

- Work in worktrees, merge to main, task files through `npm run tasks`.
  One ticket per build step; every step's ticket ends in `testing/` for the
  owner — never in `completed/` by an agent.
- The safety shapes are untouchable: draft-then-publish two calls, DELETE =
  202 + mail, postcard send owner-cookie-only, nothing an agent holds
  raises credits, GPS store readable by no route, no invented content.
- **Builder ≠ verifier**: you orchestrate; sub-agents build; different
  sub-agents (given only the spec and a URL) verify. Your own claim that a
  step works is not a gate.
- Contract layer new, domain layer shared: a v2 route is schema.parse →
  existing domain function → full-document echo. Never import v1 route glue
  (the import-boundary test enforces it — build it first, see 04).
- Anything surprising becomes a `backlog/` ticket, never silent scope.

## Where the review pages went

The five review artifacts (concept, schemas review, contract, API explorer,
migration plan) were deleted by the owner after everything was committed —
the repo is the record now. Nothing was lost:

- Decisions (all of them, by id): `00-decisions.md` here.
- Full contracts, challenges, ticket scan, openapi.json:
  `docs/plans/2026-09-12-api-v2/`.
- The plan: `02-plan.md` + `03-build-order.md` here.
- The Swagger-style explorer: `explorer.html` here — serve the repo root
  (`python3 -m http.server`) and open
  `/docs/v2-migration/explorer.html`; it reads
  `../plans/2026-09-12-api-v2/openapi.json`.

If the owner wants a review page again, publish a fresh artifact from the
repo content — never rely on the old URLs, they are gone.
