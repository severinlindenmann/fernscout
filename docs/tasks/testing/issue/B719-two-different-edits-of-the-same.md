---
id: B719
title: Two different edits of the same length collide on one idempotency key
type: ISSUE
priority: medium
complexity: low
area: agent, api
found: "2026-09-07T11:44:10Z"
started: "2026-09-08T19:51:05Z"
merged: "2026-09-08T20:04:17Z"
---

# B719 — Two different edits of the same length collide on one idempotency key

## Why

`components/AgentWizard.tsx` builds its idempotency key as
`${trip}/${slug}/${prose.length}`. Two different edits of the same draft that
happen to be the same number of characters produce the same key, so the second
one is answered `409` instead of being written up — and a person who rewrote a
sentence to the same length is told, wrongly, that they already asked this.

The fix is a key that is random per attempt and survives a re-render. It was
left because another session was in the same file at the time (B684 was built
beside B683).

## Acceptance

Two different edits of equal length both get a write-up. The key is not derived
from the content.

## Found still real

Confirmed on `main` as of this session: `writeUp()` in
`components/AgentWizard.tsx` (then line 751) built
`idempotency_key: \`${day.trip}/${day.slug}/${prose.length}\``. The server's
`recall()`/`fingerprintOf()` in `lib/idempotency.ts` compares the full body
against what a key already answered for, so two edits of equal length but
different words hit the same key with different fingerprints and got
`{ error: "idempotency_conflict" }`, HTTP 409, from
`app/api/helper/[user]/day/write-day/route.ts` — never written up, and the
person is told (via the generic failure sentence) that the call did not go
through, when really it was refused as a spurious replay of a *different*
day's notes.

## What changed

- `lib/helper/attemptKey.ts` (new): `attemptKeyFor(store, content)` — a random
  key per distinct string, memoised in a `Map` the caller owns. Unseen content
  gets a fresh `crypto.randomUUID()`; content seen before gets the same key
  back, which is what keeps a genuine retry (same notes, tapped again after a
  timeout) still deduped against a second credit spend.
- `components/AgentWizard.tsx`: added a `writeUpKeys` ref (`Map<string,
  string>`) and changed the `write-day` call's `idempotency_key` from
  `${day.trip}/${day.slug}/${prose.length}` to
  `attemptKeyFor(writeUpKeys.current, prose)`. The key is now random and keyed
  by the whole of the notes, not their length, so two different edits can
  never collide just because they happen to be the same size.
- `test/helper-attempt-key.test.ts` (new): unit tests for `attemptKeyFor` —
  two different equal-length strings get different keys, the same string
  tapped twice gets the same key back, and the key is neither the content nor
  a length.
- Left `describe-photos`'s own `idempotency_key` (`.../describe/${draft.photos}`,
  same file) untouched — its own comment already documents and accepts that a
  photo swap of equal count collides, which is a different, already-considered
  trade-off for captioning rather than the write-day bug this ticket is about.

## Acceptance, walked

- "Two different edits of equal length both get a write-up." —
  `test/helper-attempt-key.test.ts`'s first test proves the key-selection
  function used by `writeUp()` gives two same-length, different-content edits
  different keys, so the server's fingerprint check no longer sees them as the
  same call. (No route-level 409 possible for this pair any more, since the
  keys sent are now distinct by construction.)
- "The key is not derived from the content." — the key is
  `crypto.randomUUID()`, unrelated to the content's bytes or length; the
  third test in the same file asserts it is neither the string nor its
  length. (It is *keyed by* content in a `Map`, which is what preserves the
  retry-dedup the code comment there describes — but the key's own value
  carries no information about the content.)

## Verify

`npm run verify` — full run, exit 0: build, tsc, eslint, 444 test files /
5745 tests passed (4 skipped, pre-existing and unrelated), knip clean. No
known-noise failures (no `task-ids.test.ts` staleness, no 30s timeouts) this
run.

