# Status log — keep this true

Update after EVERY step: what happened, commit ids, live-validation
evidence (commands + observed output), tickets filed, what is next. The
next session starts by reading this file.

## 2026-09-12 — handoff written (session ending here)

- Phase 0 DONE: golden contract on branch b1587-api-v2-schemas —
  lib/api/v2/schemas/* frozen, 30 tests green, V/T verdicts folded
  (dayPatch/tripPatch, cover-not-at-create, translations.intro,
  checkPatchConflicts). openapi.json + area contracts + challenges + ticket
  scan in docs/plans/2026-09-12-api-v2/.
- Phase 1 DONE: fernscout.ch locked — signup disabled + ALPHA banner
  (EN/DE) in /var/lib/fernscout/config.json (backup:
  config.json.pre-alpha-20260912). Verified: /api/health status ok with
  off including signup; POST /api/auth/signup/request ->
  {"error":"signup_disabled"}; banner renders on the landing page.
- B1587 is the umbrella ticket (in-development; move to testing when this
  branch merges). B1592 captured (units field inert). B1588 superseded
  (duplicate capture).
- NEXT: phase 2 step 1 (v2 plumbing) per 03-build-order.md.
