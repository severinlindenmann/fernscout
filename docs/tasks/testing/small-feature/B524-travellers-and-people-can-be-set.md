---
id: B524
title: travellers and people can be set when a trip is created and never again
type: FEATURE
priority: high
complexity: medium
area: api, trips
found: "2026-09-05T21:30:00Z"
started: "2026-09-05T21:20:42Z"
merged: "2026-09-05T21:32:12Z"
---

# B524 — travellers and people can be set when a trip is created and never again

## Why

Reported from a real import. Both fields are creation-only, and there is no
door afterwards:

```
PATCH /api/v1/<user>/trips/<trip>        → "This route takes DELETE and nothing else."
PATCH /api/v1/<user>/config {"travellers": …} → unsupported_field
```

`agent.md` says "a trip that already exists takes the same block written into
its `trip.md`" — advice with nowhere to go on a hosted instance, which is
exactly the shape B352 (rates) and B396 (visibility) were opened to fix. The
only remaining route is DELETE the trip and rewrite every day and every
photograph, and once days are published that is not reversible.

"My partner was on this trip too", arriving after the trip exists, is the
ordinary case rather than the exception.

The narrow half of B245, which stays open for `title`, `start`/`end` and
`cover`.

## Work

Two more one-field doors, built the way `.../visibility` and `.../rates` were —
a textual splice of `trip.md`, `matter()`-parsed before writing so a corrupting
edit writes nothing:

- `GET|PATCH /api/v1/<user>/trips/<trip>/travellers` — the cheap half. Purely
  cosmetic; reuse `travellersBlock()` from `lib/tripWrite.ts` for validation so
  the create call and this one cannot disagree about a hair colour.
- `GET|PATCH /api/v1/<user>/trips/<trip>/people` — reuse `peopleBlock()`.
  **Owner only**, and the response has to say what changed in access terms:
  adding a name grants write access to the whole trip; removing one takes it
  away, and any trip-scoped token that name already holds keeps working until
  it expires unless it is revoked. Say both plainly rather than reporting `ok`.
- Both replace the block wholesale, like `costs:` and `translations:` in
  `updateDraft` — send the whole list. A PATCH that named one person and
  silently dropped the rest is the failure this must not have.
- Update the 405 body on the trip route to name the two new doors, and the
  "two fields can only be set here" table in the guide (see B526).

Not doing: per-person PATCH, or removing a person's grants as a side effect.

## Acceptance

- `PATCH .../trips/<id>/travellers` with a party changes `trip.md` and the hero
  draws it; a bad hair colour is refused by name, not dropped.
- `PATCH .../trips/<id>/people` changes the byline and write access; a
  trip-scoped token is refused (403) on both routes.
- A malformed body leaves `trip.md` byte-identical (a test that asserts it).
- `npm run verify` green.
