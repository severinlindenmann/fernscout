---
id: B735
title: Withdrawing photo consent also withdraws consent for words
type: ISSUE
priority: low
complexity: low
area: agent, consent
found: "2026-09-07T12:22:18Z"
started: "2026-09-07T12:55:03Z"
completed: "2026-09-07T13:35:43Z"
---

# B735 — Withdrawing photo consent also withdraws consent for words

## Why

B687 split helper consent into scopes — `words` and `photos` — so that
agreeing to send your notes is not taken as agreeing to send your photographs.
That part is right and is the whole reason the split exists.

But `revokeHelperConsent` deletes the file, and both the words panel and the
photos card call it. So somebody withdrawing permission for *photographs* also
silently withdraws it for their words, and the next write-up asks again with no
explanation of why.

Consistent with the one-file design, and still surprising to the person doing
it — which is the only test that matters for a permission.

## Work

Give `revokeHelperConsent` a scope that rewrites the file rather than deleting
it, and delete only when the last scope goes.

## Acceptance

Withdrawing photo consent leaves the words consent standing, and the panel says
which one was withdrawn.

## What changed

`revokeHelperConsent(username, scope: HelperScope)`
(`lib/helper/consent.ts:121-134`) now takes a required scope, removes only
that scope from `scopes` and `providers`, and rewrites the file — the whole
record is deleted only once `scopes` is empty.

`DELETE /api/helper/[user]/consent` (`app/api/helper/[user]/consent/route.ts`)
now reads `{ scope }` from the body the same way `POST` does (defaulting to
`words` when the body says nothing, matching every panel that predates the
split) and passes it through. The route's own gate is unchanged and
deliberately stays "any capability on" rather than "this scope's capability
on" — see the updated comment in that file — so withdrawal still works even
if the specific capability was switched off after the fact.

`components/AgentWizard.tsx`'s `withdraw` callback (formerly no-argument, one
call site for both the words button and the photos button) now takes
`"words" | "photos"` and each button passes its own scope
(`components/AgentWizard.tsx:943`, `:1018`). Each button already sits under
its own section (`agent.helperHint` / `agent.describePhotosHint`), so which
permission is being withdrawn is contextual to where the button lives — no new
copy was needed to satisfy "the panel says which one was withdrawn."

**What this means for somebody who withdraws today:** withdrawing photo
consent now leaves a standing words consent (and vice versa) instead of
deleting the whole record. Nobody's consent is widened by this change — the
new behaviour is strictly narrower than before (it revokes *less*, on
request, than the old code did).

## Test

`test/helper-consent.test.ts`, "B735 — withdrawing one scope leaves the
others standing":
- `revoking photos leaves words consent in place, and genuinely removes
  photos` — asserts `hasHelperConsent("alex", "photos")` goes from `true` to
  `false` (genuinely gone) while `hasHelperConsent("alex", "words")` stays
  `true` with its provider intact (not silently widened or dropped).
- `revoking the last scope removes the file entirely` — the delete-on-empty
  path.
- `revoking a scope nobody agreed to is a no-op on the others`.

Also fixed `test/helper-ask.test.ts`'s only direct call to
`revokeHelperConsent("alex")` (no scope), which the new required parameter
would otherwise have silently no-op'd (an `undefined` scope matches nothing in
`.filter((s) => s !== scope)`, so no scope would ever be removed) — passed
`"words"`, matching what that test's `beforeEach` actually consents to.
