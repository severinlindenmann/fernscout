---
id: B743
title: One provider name is recorded for three different consents
type: ISSUE
priority: medium
complexity: low
area: agent, consent
found: "2026-09-07T12:46:56Z"
started: "2026-09-07T12:55:04Z"
completed: "2026-09-07T13:35:42Z"
---

# B743 — One provider name is recorded for three different consents

## Why

`lib/helper/consent.ts:47` — `HelperConsent.provider` is a single string, but
there are now three scopes and **two providers**: `words` and `photos` go to
Anthropic, `speech` goes to Deepgram.

So agreeing to speech overwrites the provider recorded against the words
consent. That file's own comment promises "a change of provider is not silently
covered by an old yes", and after B686 that promise holds only in the panel
text a person reads, not in the record the file keeps. The record is the part
that has to be true a year later.

## Work

A `providers` map keyed by scope, replacing the single string. Keep reading the
old shape — a file written before this change has one provider and the scopes
it was granted for.

## Acceptance

A journal that agreed to words (Anthropic) and speech (Deepgram) has both
recorded, and changing either provider re-asks only for that scope.

## Shape chosen

`HelperConsent.providers: Partial<Record<HelperScope, string>>` replaces the
single `provider: string` (`lib/helper/consent.ts:41-50`). `agreedAt` stays a
single top-level instant — "when this record was last given or extended" —
since nothing reads a per-scope timestamp today and adding one would be
speculative.

`recordHelperConsent(username, provider, scope)` now writes
`providers[scope] = provider` rather than overwriting a single field
(`lib/helper/consent.ts:104-115`), so re-consenting to `speech` with a new
transcriber cannot touch what `words` recorded, and vice versa.

`revokeHelperConsent` gained a required `scope: HelperScope` parameter
(`lib/helper/consent.ts:121-134`), which B735 needed anyway — see that file
for the withdrawal behaviour.

### Migration: an existing single-provider file

`helperConsent()` (`lib/helper/consent.ts:59-77`) reads three shapes:

1. **New shape** — a `providers` object. Used as-is.
2. **Old shape** — a top-level `provider: string` and a `scopes` array.
   Read as `providers[s] = provider` **for every scope already in that
   file's own `scopes` array, and no other scope.** A words-only file from
   before B687 (`scopes: ["words"]`) becomes `{ words: "Anthropic" }` —
   `photos` and `speech` stay absent, exactly as absent as they were before
   this change. A file already carrying `scopes: ["words", "photos"]` (both
   consented to under the shared field) becomes
   `{ words: "Anthropic", photos: "Anthropic" }` — which is the same
   provider name it already had, so nobody's grant widens or narrows.
3. **Neither `providers` nor `provider`** — treated as no consent at all
   (`null`), the same "unreadable file means nobody has said yes" rule the
   function already followed.

**What this means for somebody who consented under the old shape:** nothing
changes about what they are considered to have agreed to. Their file is
rewritten to the new shape the next time any scope is recorded or revoked;
until then it is read losslessly through the migration above. No scope is
added, removed, or reassigned to a different provider by this change alone.

### What is *not* done

The acceptance line's second half — "changing either provider re-asks only
for that scope" — describes provider-drift detection (an owner switches the
transcription backend in `site/config.json`, and the *next* attempt to use
that scope should be refused pending a fresh consent, because the recorded
provider no longer matches what is configured). **No code path implements
this, before or after this change** — `hasHelperConsent()` only checks scope
membership, never compares `providers[scope]` against the currently
configured provider (`HELPER_PROVIDER`, `speechProvider()`). The `providers`
map now *carries* the information such a check would need, but nothing reads
it that way yet. Filed as a new capture rather than folded in here, since it
is a different mechanism from "record a provider per scope."
