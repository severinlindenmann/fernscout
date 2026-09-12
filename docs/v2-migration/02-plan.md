# The plan — the clean cut (final form, M1-M4 decided)

Context: test instance. Two journals (`example` + the owner's). No
third-party agents. Full permission to recreate. Speed over ceremony.
Therefore: NO parallel v1/v2 operation, NO aliases, NO deprecation
headers, NO parity suite, NO dual-read shims (one exception below), NO
blue/green. The protection is the ALPHA lock + the instruments (04).

## Phases

0. **Golden contract** — DONE (see 01).
1. **Lock the door** — DONE. Live instance: signup disabled, ALPHA banner
   (EN/DE) in FERNSCOUT_CONFIG (/var/lib/fernscout/config.json on the VPS;
   pre-alpha backup beside it). Verified: /api/health off:[signup], POST
   signup/request -> signup_disabled, banner renders on the landing page.
2. **Build, area by area** — the loop in 03-build-order.md. v1 deleted in
   the same merge that replaces it. Deploy per step; validate live per
   step. The DB is dropped when the new auth lands (M1): stop service,
   drop/recreate DB, deploy, owner signs in fresh.
3. **Replay `example`** — the migrator reads old example content with v1
   readers (or the last pre-deletion copy in git history) and re-creates
   it through v2's real HTTP API on the live instance. Extend example
   where a feature has no expression yet (M3): figures, both weather
   routes, statement flow, translations incl. intro, all three trip
   visibilities, teaser, per-photo holdback, a draft + published day, an
   invite, costs with manual rate. The migration report lists every
   transformation; the standard decline sentence is in 00-decisions.md.
4. **Finish line** — last v1 file deleted (lib/api/openapi.ts included),
   the migrator deleted after its run, AGENTS.md + skills + /documentation
   rewritten for v2, superseded tickets closed by the owner. Banner stays
   until the owner ends the alpha (product decision, not yours).

## What "no legacy" means (checklist for phase 4)

- No route under app/api/v1, app/api/helper (except what 03 explicitly
  keeps under /api/web), app/api/journal, app/api/trip, app/api/reactions
  (old path), /api/v1/me/*.
- lib/api/openapi.ts, skillDocs markers, agentGuide monolith, agentCopy
  field fragments, doors section in content-model, tracks vocabulary,
  personal invite kind (write side), fulfilment flags: deleted.
- Content: example contains no `features`, `manualRates`, `tracks:`,
  `status:`, `startLocation`, inline `travellers:`, `costs: false/
  "unknown"`. (The owner's journal is theirs; v2 readers will only read
  v2 content — their migration is their own, tool provided.)
- knip green is the mechanical proof; the inventory of THIS list is the
  human one.
