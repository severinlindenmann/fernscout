---
id: B1587
title: API v2: document-oriented, required-or-declined contract (phase 0: Zod schemas)
type: FEATURE
priority: high
complexity: high
area: api
found: "2026-09-12T13:45:05Z"
started: "2026-09-12T13:45:48Z"
session: 35a4360e-ce08-4e73-b635-477f5ac0c864
claimed: "2026-09-12T13:45:48Z"
---

# B1587 — API v2: document-oriented, required-or-declined contract (phase 0: Zod schemas)

## Why

Agents forget fields because the current contract makes forgetting legal: the
v1 surface is ~50 routes plus ~40 `helper/*` routes duplicating them, fields
are optional-by-default, validation is hand-rolled, and `lib/api/openapi.ts`
is a 4,851-line hand-kept promise that drifts from the code (the B540 failure
class: fields accepted, 201 answered, silently thrown away).

The concept — reviewed and decided with the owner on 2026-09-12 — is at
https://claude.ai/code/artifact/b98c2a46-81b8-48e8-9791-b1302cd6499e
Summary of the decided direction:

- Zod in Next.js (no FastAPI sidecar). One schema per resource is the
  validator, the TypeScript type, and generates `/v2/openapi.json`.
- Seven document-oriented resources: journal, trips, trip, day, publish,
  media (single binary door: photo | bank_export | gps_history | document),
  status.
- Three field classes: always-required (title, dates, ≥1 person, explicit
  visibility) / required-or-declined (`declined: {field: reason}` map,
  persisted in frontmatter, returned on GET) / server-owned (status, track,
  fetched weather — rejected in writes). Silent omission answers 422 whose
  body lists each missing field with why_required, a schema excerpt, and how
  to decline. Every successful write echoes the full stored document.
- Storage stays markdown; JSON is wire-only; one round-trip-tested serializer.
- The per-journal `features` block leaves journal config — instance-only via
  `resolveCapabilities()`; old blocks parse and are ignored.
- Four-prefix split: /api/v2 (bearer, contract) · /api/web (cookie-only
  internals incl. helper backend and sync) · /api/auth · /api/webhooks.
- One error envelope from `lib/api/errorCodes.ts`; client-chosen ids
  everywhere (retried create → 409 with stored document); evolution policy
  additive-only within v2 (no v3); per-token request logging, metadata only.
- Contract layer new, domain layer shared: a v2 route never imports v1
  route glue (import-boundary test in the gps-store/postcard-orders
  pattern); one writer of the markdown format; a golden corpus round-trips
  every existing file byte-identical; a v1/v2 parity test during parallel
  operation with a quirk ledger naming every deliberate divergence.
- Publish stays a separate second call; DELETE stays 202 + mail; gps store
  stays unreadable — v2 changes the shape of writing, not the safety
  decisions.
- Migration: schemas first (they are the spec) → parallel /v2 for BYO agents
  → helper rewired onto v2 → webapp + long tail → v1 sunset.

## Work

Phase 0 only (this ticket): the Zod schemas as the reviewable spec, plus a
visual representation of every schema for the owner's feedback.

- `lib/api/v2/schemas/` — journal, trip (with day, people, rates, costs,
  plan, declined, weather sub-schemas), media intent, status, error envelope.
  Enums imported from the constants the v1 validators use, never retyped.
- A test that parses the concept's own example documents against the schemas.
- The visual schema page (artifact) for field-by-field review.

Not doing here: routes, the md↔JSON serializer, openapi generation wiring,
helper migration — each is its own later ticket once the schemas are blessed.

## Acceptance

- `npx vitest run test/api-v2-schemas.test.ts` passes: valid example documents
  parse; a document silently omitting a declinable section fails with the
  incomplete shape; server-owned fields in a write are rejected.
- The owner has reviewed the visual schema page and blessed the field lists.
