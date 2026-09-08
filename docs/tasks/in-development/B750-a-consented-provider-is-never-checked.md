---
id: B750
title: A consented provider is never checked against the one now configured
type: ISSUE
priority: low
complexity: low
area: agent, consent
found: "2026-09-07T13:08:42Z"
started: "2026-09-08T21:09:18Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:09:18Z"
---

# B750 — A consented provider is never checked against the one now configured

## Why

B743 gave each consent scope its own recorded provider
(`HelperConsent.providers`, `lib/helper/consent.ts:41-50`), so `words` and
`speech` no longer share one string. But `hasHelperConsent()`
(`lib/helper/consent.ts:76-78`) still only checks whether a scope is in
`scopes` — it never compares the provider that scope was granted under
against the one actually configured now (`HELPER_PROVIDER` in
`lib/helper/model.ts`, `speechProvider()` in `lib/helper/transcribe.ts`).

So an owner who consented to speech going to Deepgram, and whose operator then
switches `features.transcription.backend` to a different transcriber, keeps
using that new provider on the strength of a yes that named a different one —
with nothing in the code path noticing the mismatch. B743's own acceptance
line ("changing either provider re-asks only for that scope") describes this
check; the data model now carries what it would need, but nothing reads it
that way.

## Work

Somewhere on the consent-checking path (`hasHelperConsent`, or the callers in
`app/api/helper/[user]/day/write-day/route.ts`,
`.../day/describe-photos/route.ts` and `.../transcribe/route.ts`), compare the
scope's recorded `providers[scope]` against the provider actually configured
for that scope today. A mismatch should read as "not consented" for that
scope — the same 403 as no consent at all — rather than silently proceeding
under the new provider's name.

Decide what happens to a pre-B743 migrated record (see B743's "Shape chosen"
section) that has no way to distinguish "explicitly agreed to this provider"
from "provider name back-filled by the migration" — the migrated value should
probably still compare equal to whatever it was migrated from, so this does
not manufacture a re-ask for every journal on the first request after
deploying B743.

## Acceptance

A journal consents to speech going to Deepgram. The operator switches the
`transcription` backend to a different provider (or to `dry-run`) in
`site/config.json`. The next `POST /api/helper/<user>/transcribe` is refused
with `consent_required` rather than silently transcribing under the new
provider's name, and re-consenting records the new provider for `speech`
only — `words`/`photos` consent is untouched.

## Resolution (2026-09-08)

Confirmed still live before touching anything: `hasHelperConsent()`
(`lib/helper/consent.ts`) only checked `scopes.includes(scope)` and never
looked at `providers[scope]` at all — exactly as the ticket said. No sibling
ticket covers it (searched `docs/tasks/` for "consented provider" and B750;
only this file and `INDEX.md` matched).

**What changed:**

- `lib/helper/consent.ts` gained `currentHelperProvider(scope)` — the same
  `speech → speechProvider()`, `sessions → serverSite().name`, else
  `HELPER_PROVIDER` mapping the consent route already computed inline — and
  `hasHelperConsent()` now returns `true` only when the scope is granted
  **and** `providers[scope] === currentHelperProvider(scope)`. A missing or
  mismatched provider reads as "not consented", the same as no record at all
  — fails safe, never silently proceeds under the new name.
- `app/api/helper/[user]/consent/route.ts` now calls the exported
  `currentHelperProvider()` instead of repeating the same three-way mapping,
  so there is exactly one place that decides who a scope's yes names today.
- No special-casing was added for a pre-B743 migrated record: its
  `providers[scope]` is backfilled from the single old `provider` string
  (already the case since B743), and comparing that literally against
  `currentHelperProvider(scope)` is correct on its own — if the provider
  genuinely has not changed since the migration, they read equal and nothing
  re-asks; if it has changed, that is exactly the mismatch this ticket asks
  for. No manufactured re-ask on the first request after deploying B743.

**Tests** (fail before this change, pass after):

- `test/helper-consent.test.ts`, new `describe("B750 …")`: a scope recorded
  under one provider is not honoured once the configured provider differs;
  consenting to whatever is currently configured is honoured; a mismatch on
  one scope leaves another scope's consent untouched.
- `test/helper-transcribe.test.ts`, new test "switching the transcription
  backend after consent re-asks for speech": consents under `dry-run`,
  switches `site/config.json` to `deepgram` (with a stub `DEEPGRAM_API_KEY`
  so the capability stays enabled), asserts the next
  `POST /api/helper/<user>/transcribe` comes back `403 consent_required` with
  `transcribeAudio` never called, then re-consents and confirms the call goes
  through.

**Acceptance walked line by line:**

- "A journal consents to speech going to Deepgram" — `consent()` helper in
  the transcribe test records `speech`.
- "operator switches the backend... in site/config.json" —
  `writeServerConfig({ transcription: { backend: "deepgram" } })` after the
  first consent, simulating the operator's own edit.
- "next POST .../transcribe is refused with consent_required" — asserted
  directly; `transcribeAudio` is asserted uncalled.
- "re-consenting records the new provider for speech only" — asserted by a
  second `consent()` call succeeding, and by
  `test/helper-consent.test.ts`'s "a mismatch on one scope leaves the others
  untouched" test showing `words`/`photos` are never touched by a speech
  re-consent.

**Not touched:** B744 (the panel names Deepgram even on dry-run) and B735
(withdrawing photo consent also withdraws words) are untaken and this ticket
does not absorb either — `revokeHelperConsent()` and the consent panel copy
are unchanged. B722 (whether the consent record is in a journal export) is
also untouched; `consentFile()`'s doc comment already says it is queued into
the `"all"` export scope and nothing here changes that claim either way.

`npm run verify` run in full; see session notes for the result (build/tsc/
eslint/vitest/knip all green, or noise noted, at merge time).
