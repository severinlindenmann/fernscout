# Phase 2 — the build loop, step by step

Each step is one run: worktree -> build -> `npm run verify` -> merge ->
deploy (`.claude/skills/vps/ship.sh`) -> live validation -> ticket to
testing/ -> update 05-status.md. Capture a ticket per step with
`npm run tasks -- new` (reference B1587 in prose). Dispatch builder
subagents on sonnet; keep verifier subagents separate (04).

Steps 1-2 are infrastructure the rest depends on. After that, order is
dependency-shaped; within a step you may parallelise files, but merge and
deploy serially.

## Step 1 — v2 plumbing (no public routes yet)
- lib/api/v2/: the route helper (parse -> envelope -> echo), incompleteFrom
  (Zod issues -> the 422 missing[] body with to_provide schema excerpts),
  dryRun handling, ETag helper, request logging (decided: per-token,
  metadata only, never bodies), describeScope() in lib/auth.
- The import-boundary test (v2 routes import lib/api/v2/** + an explicit
  domain allowlist; nothing from v1 route files).
- The md<->JSON serializer for the v2 content shape + tests. v2-canonical
  only — no unknown-key preservation (the replay replaces content).
- Live validation: none (nothing public). Deploy anyway to keep the loop
  honest.

## Step 2 — auth (area contract: auth.md; DB DROP rides this step)
- Build /api/auth/codes, codes/redeem, links/redeem, {user}/handover
  (mint moved), handover (exchange), signup/phone + redeem, identity/
  upgrade + logout (kept), keys (ONE mixed door, Q1). for-vocabulary on
  the wire; V13 per-address bucket; handover-mint refuses short tokens.
- DELETE the six old code/verify routes, both link routes, the old
  keys/handover paths.
- Deploy with the DB drop (M1): systemctl stop fernscout; drop/recreate
  the database; deploy; owner signs in fresh (their action — hand them the
  exact steps and wait).
- Live: full code matrix vs fernscout.ch (read + write + identity +
  signup-disabled refusal), keys list/revoke, handover mint+exchange.

## Step 3 — core documents
- Routes for journal (GET/PATCH + DELETE 202), trips (GET/POST list+create,
  GET/PUT/PATCH/DELETE one, ?days= projection), days (PUT/PATCH/DELETE),
  publish/unpublish, send (S1: ONE door, channels[]), media (GET/POST/
  DELETE, per-kind intents, day-less writes), figures (GET/PUT/DELETE +
  presets/preview moved), status x2, geocode.
- T6 retraction + V2 echo-tolerant server-owned fields in the shared write
  path. The 422/advice/notifications echoes exactly per contract.
- DELETE the corresponding v1 trip/day/media/travellers/drafts/tracks/
  status routes and their glue.
- Live: drive a test- journal end to end over the wire (create -> trip
  with declines -> days -> media -> publish -> patch -> send -> delete via
  mail). Refusals checked as much as successes.

## Step 4 — long tail
- statements/{src} + costs/apply, inbox GET/DELETE, journals create +
  available, invites, contacts (+ approve/revoke/resend + import),
  channels, purchases (PUT) + ledger + storage read, postcards orders
  (PUT/GET) + recipients + texts, photobooks order GET.
- DELETE their v1 counterparts (incl. /api/contacts/request, personal
  invite writes, fulfilment flags).
- Live: per-resource smoke + refusals; postcard proposal end to end up to
  the owner page (never send).

## Step 5 — /api/web + the helper + the webapp
- The cookie proxies (EditDay pattern, V1: in-process bearer, never
  client-held): PATCH {user}, trips/{trip}, days/{slug}, unpublish,
  visibility. app/api/journal + app/api/trip die.
- Helper: agent/turn (ask), model/{job} family, consent, sessions,
  day-undo, trip files; tools repointed at v2 handlers ONE AREA PER MERGE
  (day -> trip -> media/inbox -> contacts/invites -> money/storage),
  deleting each helper route group as it repoints. The truth-guard
  declined-matcher lands with the FIRST declining tool (Q12).
- me/*, push, reactions (nested path, oracle discipline byte-identical),
  admin/* -> /api/web/admin, address-lookup move, sync/manifest+file+
  export.zip -> /api/v2 (owner scope).
- Webapp pages: repoint fetches in the same merge as their route moves.
- Live: persona round on /agent per repointed area (test-with-personas);
  test-in-a-browser per changed page at 390px on pre-existing content.

## Step 6 — docs generation
- /api/v2/openapi.json served from the schemas; /docs/{resource}.md
  generated; documentation.txt slimmed to narrative; the nine /skill task
  guides become thin composers; markdownTwin render walks dayDoc's shape.
- DELETE skillDocs markers, agentGuide monolith, agentCopy field fragments.
- Live: fetch every generated doc; a fresh verifier agent must build a
  trip using ONLY the served docs (04).

Then phase 3 (replay example) and phase 4 (finish line) per 02-plan.md.
