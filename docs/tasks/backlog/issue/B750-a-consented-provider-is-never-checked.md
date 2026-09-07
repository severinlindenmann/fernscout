---
id: B750
title: A consented provider is never checked against the one now configured
type: ISSUE
priority: low
complexity: low
area: agent, consent
found: "2026-09-07T13:08:42Z"
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
