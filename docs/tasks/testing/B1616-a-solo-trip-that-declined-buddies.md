---
id: B1616
title: "A solo trip that declined buddies can never add people, and a public trip can never be narrowed"
type: ISSUE
priority: high
complexity: medium
area: API v2
found: 2026-09-12T00:00:00Z
merged: "2026-09-12T21:33:17Z"
---

## Why

Two dead-ends in `PATCH /api/v2/{user}/trips/{trip}`, found while repointing
`test/trip-party-api.test.ts` and `test/trip-visibility-api.test.ts` to the v2
routes (B1612). Both are the same shape: **a stored answer that no patch can
retract**, so the trip is locked into a state forever.

Both were found because the tests were rewritten honestly rather than bent to
pass. That is the whole argument for the repointing discipline.

### 1. A solo trip can never gain a buddy

`tripCreate` asks the buddy question of a trip with one person: add the
people who were there, or `declined.buddies`. A solo trip declines.

Later, somebody remembers a friend was on that trip. They `PATCH` with the
fuller `people` array. It is refused — for as long as the trip exists:

- The stored `declined.buddies` is still there.
- T6's retraction (`retractDeclines`, `lib/api/v2/write.ts`) clears a stored
  decline only when the patch **supplies a field of that name**. There is no
  `buddies` field — it is derived from `people.length`.
- So the merged document has both `people.length > 1` and
  `declined.buddies`, which `tripCreate`'s own superRefine refuses as
  *"buddies are both listed in people and declined"*.

There is no body that fixes it. The decline cannot be cleared and the people
cannot be added.

### 2. A public trip can never be made private or guest

v1's dedicated `.../visibility` route dropped a stale `listed` when narrowing.
v2 folded that route into the trip document and nothing took over the job:

- Every public trip carries `listed` (it is required-or-declined on a public
  trip).
- `PATCH {visibility: "private"}` merges onto the stored document, which
  still has `listed`.
- The revalidation refuses it: *"a closed trip is never advertised, so there
  is nothing to list or to decline — remove listed"*.
- A caller cannot remove it in the same call — `listed: null` is not the
  shape, and omitting it means "unchanged" under merge-patch semantics.

Somebody who published a trip and then wants it closed cannot close it
through the API.

## Work

These are route-layer problems, not schema problems. **The schemas are right**
— the conditional rules they state are the ones we want. What is missing is
the route doing the merge correctly, which is exactly where `00-decisions.md`
says conditional rules needing the stored document belong.

- **Buddies**: teach `retractDeclines` (or the trip route's own merge) that
  `buddies` is answered by `people`, not by a field called `buddies`. A patch
  that supplies `people` with more than one entry answers the buddy question
  and must clear `declined.buddies`.
- **Narrowing**: when a patch changes `visibility` from `public` to a closed
  value, drop the now-meaningless `listed` — and any `declined.listed` —
  before revalidating, and require `teaser` (the closed trip's own question)
  either in the patch or already stored. Widening the other way is the
  mirror: drop `teaser`, ask `listed`.

Both fixes belong in the shared trip write path so the `/api/web` cookie door
(step 5) inherits them rather than reimplementing them.

Not doing: loosening the schema's conditional refusals. They are correct and
they are what caught this.

## Acceptance

- A trip created solo with `declined.buddies` accepts a later `PATCH` adding
  a second person, and the stored decline is gone afterwards.
- A public trip accepts `PATCH {visibility: "private", teaser: false}` and
  comes back closed, with no `listed` on it.
- A closed trip accepts `PATCH {visibility: "public", listed: true}` and comes
  back public with no `teaser`.
- `test/trip-party-api.test.ts` and `test/trip-visibility-api.test.ts` have
  their deliberately-failing blocks passing, with no assertion weakened.
