---
id: B1600
title: "v2 auth: one codes door, links redeem, keys, handover mint moved — and the six v1 code routes deleted"
type: CHORE
priority: high
complexity: high
area: API v2
found: 2026-09-12T00:00:00Z
started: "2026-09-12T17:27:23Z"
session: ea65563f-a0a9-407d-afe4-aaeeceab7f38
claimed: "2026-09-12T17:27:23Z"
---

Phase 2 step 2 of the v2 migration (B1587 is the umbrella; the brief is
`docs/v2-migration/03-build-order.md`). B1596 built the plumbing this sits
on.

## Why

v1 asks for a credential through six doors that differ only in which kind of
session they mint — `auth/request` + `verify`, `auth/identity/request` +
`verify`, `auth/signup/request` + `verify`, plus two link redeemers beside
them. Six doors, one question. An agent reading the document has to work out
which pair applies to it before it can ask for anything at all, and the four
rate-limit ceilings they enforce between them live in four places that can
drift.

v2 asks the question once: `POST /api/auth/codes` with a `for:` of `read`,
`write`, `identity` or `signup`, and `POST /api/auth/codes/redeem` to spend
it. `POST /api/auth/links/redeem` replaces both link routes. The design is
`docs/plans/2026-09-12-api-v2/auth.md`.

## Work

Three parts, built in one worktree, merged once.

- **A — the codes doors.** `lib/api/v2/schemas/auth.ts` (the `for` vocabulary
  and the request/response shapes), `app/api/auth/codes`, `codes/redeem`,
  `links/redeem`. Delete the eight route files they replace. Update
  `lib/api/openapi.ts` — it is legacy that step 6 deletes, but until
  `/api/v2/openapi.json` is served it is the document an agent reads, and
  `test/openapi-contract.test.ts` is the gate.
- **B — the callers.** Repoint everything in `components/` and `app/[user]/`
  that fetches a deleted route, plus the copy in `lib/api/agentCopy.ts` and
  `lib/api/documentation.ts`.
- **C — keys, handover, phone.** `/api/auth/{user}/keys` (ONE mixed door —
  `00-decisions.md` Q1 overrules auth.md §2.7's recommended split),
  `/api/auth/{user}/handover` (the mint, moved off `/api/v1`),
  `signup/phone` + `signup/phone/redeem` (renames).

Three things that are not copies and must not be built as one:

1. **The keys route's `scope` field changes shape.** v1 echoes the internal
   string (`"write:trip:alps-2026"`); v2 answers `describeScope()`'s
   `{scope, trip?, expiresAt}`. The internal string is not vocabulary the
   document publishes.
2. **The handover mint gains a guard.** `00-decisions.md` says "handover-mint
   refuses short tokens" and nothing anywhere specifies the mechanism —
   `challenge-security.md` finding 2 is the origin, and V1 (no client-held
   bridge token) already removed most of the threat. What this ticket builds
   is the checkable half: the mint refuses a **trip-scoped** bearer, because
   a credential good for one trip minting a journal-wide handover is a
   widening. It does **not** invent an `origin` column or a TTL threshold —
   that is the owner's decision and is still open.
3. **V13's per-address bucket** for `for: "write"` is one `rateLimitFor` call
   with the namespace parameterised by `for`, not four call sites.

Not doing: splitting the keys door; `/api/v2/{user}/status` (that is step 3);
the DB drop (see below).

## The DB drop rides this step's DEPLOY, not this merge

`00-decisions.md` M1 drops the database when the new auth lands. **The owner
must see this list and say yes before it happens**, and should take an
out-of-band backup first. Signing in again does NOT restore:

- `credits`, `credit_ledger`, `payments` — balances and the whole audit trail
  an operator reconciles a card statement against.
- `contacts` — postal addresses (`postal_cipher`) and explicit postcard /
  digest consent, with its provenance and timestamps.
- `access_grants`, `trip_people` — every grant must be re-approved by hand.
- `usage` — paid-provider billing history; "what did last month cost" becomes
  unanswerable from the database.
- `reactions` — reader-authored content, gone.
- `tracking_points` — GPS recorded live during a trip, unrepeatable.
- `day_notifications`, `digest_sends` — what was already sent to whom; losing
  them risks duplicate sends.

Everything else (`users`, `sessions`, `login_codes`, `push_subscriptions`,
`jobs`, `idempotency`, `helper_sessions`, `admin_acks`, `analytics_events`)
regenerates or is transient.

## Acceptance

- `POST /api/auth/codes` answers `202` for all four `for` values, and still
  answers `202` for an address this instance has never seen — the door cannot
  be used to ask who has an account.
- A wrong, spent or expired code is `invalid_code` 401 uniformly; a spent
  link is `link_spent` 401 uniformly. Neither refusal distinguishes the cases.
- `for: "read"` and `"identity"` put no token in the response body; `"write"`
  and `"signup"` set no cookie. Decision 24, mechanically.
- A trip-bound code yields a trip-scoped token and never a journal-wide one.
- `GET /api/auth/{user}/keys` answers `{scope: "trip", trip: "…"}`, never the
  raw internal string.
- The handover mint refuses a trip-scoped bearer.
- `npm run verify` green, `test/openapi-contract.test.ts` included.
- Nothing under `app/api/auth/` fetches or documents a deleted route.
