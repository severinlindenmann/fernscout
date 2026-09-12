---
id: B1586
title: Correcting a caption or a photograph's visibility from the day panel is refused, and takes the rest of the save down with it
type: ISSUE
priority: high
complexity: low
area: day page, owner tools, edit route
found: "2026-09-12T13:44:00Z"
---

# B1586 — Correcting a caption or a photograph's visibility from the day panel is refused, and takes the rest of the save down with it

## Why

Found while starting B1585, by reading the route B1585 planned to reuse.

`components/EditDay.tsx` draws a caption box and a visibility select for every
photograph on the day, and `changesFor()` puts them in the patch as `captions`
and `photoVisibility` (`EditDay.tsx:158`, `:164`). That patch goes to
`PATCH /[user]/trips/[trip]/day/[slug]/edit` (`EditDay.tsx:222`).

That route keeps its own allow-list:

```ts
const EDITABLE = ["title", "time", "content", "location", "date", "visibility", "translations"];
…
if (keys.some((key) => !EDITABLE.includes(key))) {
  return Response.json({ error: "unsupported_field" }, { status: 400 });
}
```

`app/[user]/trips/[trip]/day/[slug]/edit/route.ts:39` and `:87`. Neither
`captions` nor `photoVisibility` is on it, so the call is refused.

**The failure is worse than the missing feature**, because it is one patch per
update: the route rejects on *any* unknown key, so a save that corrects a typo
in the title and also writes a caption writes neither. `save()` stops at the
first non-ok response (`EditDay.tsx:225`) and shows the day as failed, so the
title edit the owner actually cared about is lost with it.

Both halves are the same commit pair: `fb9b2f9e` (B980 round 1) wrote
`EDITABLE` for the fields round 1 drew; `43fb9626` (B980 round 2) added the
picture fields to the panel and did not widen it. Nothing has touched the list
since, so this has been broken since 2026-09-08.

The API's own door has always accepted both — `EDITABLE_DAY_FIELDS` in
`lib/api/entries.ts` includes them, which is what B1584 is about — so this is
the browser door alone, and the writer underneath (`editEntry`) and the
validator (`validateEntryEdit`, which the route already calls with the day's
gallery for exactly these fields) both handle them. The route is the only thing
in the way.

Nothing here is a security hole: the list is narrowing what the owner may send
through their own authenticated door, and the two fields are already accepted
from the same owner over the API.

## Work

Add `"captions"` and `"photoVisibility"` to `EDITABLE`. The comment above it
says the list is "what the panel actually draws", which is the rule that was
broken rather than a rule to change.

A test that fails now: PATCH the route with a `photoVisibility` body and assert
it is not `unsupported_field`.

Not doing: B1584's separate question of documenting these two keys in
`content-model.json`.

## Acceptance

A caption typed into the correction panel is on the day after Save. A
photograph set to `private` there is private. A save that changes a title *and*
a caption writes both.

## Closing

Fixed on `b1585-visibility-everywhere` rather than on its own branch: B1585
builds the owner's photograph-visibility control on this exact route, and could
not be accepted while the route refused the field. `test/day-edit-route.test.ts`
is the regression.
