---
id: B1625
title: "A trip or day accepts translations in a locale the journal does not declare — the schema says the route refuses it and no route does"
type: ISSUE
priority: high
complexity: low
area: API v2
found: 2026-09-12T00:00:00Z
merged: "2026-09-12T21:33:19Z"
---

## Why

`lib/api/v2/schemas/trip.ts`'s `translations` carries this comment:

> *The route refuses a locale the journal does not declare, since it would be
> written and never rendered — that check needs the journal's config and lives
> at the door.*

**No route reads `getUser(user)?.locales`.** Not the trip route, not the day
route, on create or on patch. A `PUT` with `translations: {fr: {...}}` on an
`en`/`de` journal is accepted, written, and never rendered by anything.

Two reasons this is worse than an ordinary missing validation:

1. **It is silent dead content.** Somebody translates a whole trip into French
   — real work, by a person — and it sits in the file forever, rendered
   nowhere, with nothing saying why. The failure surfaces months later as
   "why is the French missing", and the answer is in a locale list nobody
   thought to check.
2. **The contract promises it.** `AGENTS.md` is explicit that a field the
   document promises and the code drops is *worse* than one it never
   mentioned, because the caller is told it worked. Here the promise is in the
   schema's own comment — the thing an agent reads to know what the door does.

Found by `test/trip-details.test.ts` when its translations block was rewritten
against the v2 route (B1612).

## Work

Add the check at the door, for both resources, on both create and patch — it
needs the journal's config, which is exactly why `00-decisions.md` puts
conditional rules of this kind in the route rather than the schema.

- Refuse a locale not in `getUser(user)?.locales` with `invalid_translations`
  (already in `ERROR_CODES`, already says what to do: *"Declare the locale
  first … or drop it"*).
- Name every offending locale at once, not the first — the house convention
  for `problems`, so a caller fixes them in one round trip.
- It belongs in the **shared trip/day write path** (`lib/api/v2/write.ts`), not
  in two route bodies, so `/api/web` (step 5) inherits it.

Not doing: moving the check into the schema. It cannot go there — a Zod schema
has no access to the journal's config, which is precisely what the comment
already says.

## Acceptance

- `PUT` and `PATCH` of a trip, and of a day, refuse a translation whose locale
  the journal does not declare, naming every offending locale.
- A locale the journal *does* declare is accepted exactly as now.
- The schema comments that promise this become true; a test asserts it.
