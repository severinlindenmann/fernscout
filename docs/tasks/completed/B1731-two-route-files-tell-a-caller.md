---
id: B1731
title: Two route files tell a caller to POST /api/v1/{user}/import, and the dead-route guard skips every string in a route file
type: ISSUE
priority: medium
complexity: low
area: api, copy
found: "2026-09-14T11:47:56Z"
started: "2026-09-14T11:53:59Z"
merged: "2026-09-14T11:54:11Z"
completed: "2026-09-14T16:33:06Z"
---

# B1731 — Two route files tell a caller to POST /api/v1/{user}/import, and the dead-route guard skips every string in a route file

## Why

Found by grepping the instance for caller-facing `/api/v1` strings after B1716
— an audit asked for exactly that, on the grounds that one had already survived
a sweep claiming to have repointed them all.

Three strings, all instructions rather than history:

- `app/api/v1/[user]/trips/[trip]/track/route.ts:60` — when the position store
  has nothing for a trip's dates, the answer says to import the export first:
  `POST /api/v1/{user}/import`. Gone; it is `POST /api/v2/{user}/import`.
- `app/api/v2/[user]/contacts/import/route.ts:31` — the refusal for a bad
  `rows` says they come from `POST /api/v1/{user}/import (kind contacts)`.
  Same dead route.
- `app/api/v2/[user]/import/route.ts:57,218` — found only once the guard below
  was narrowed. The door's own description **and** the `next` it answers with
  both tell a caller to draw the line with
  `POST /api/v2/{user}/trips/<trip>/track`. Verified live: **404**. `track` is
  one of the three routes the migration deliberately kept on v1. This is the
  worst of them — it is the documented next step of a GPS import and the only
  answer a caller gets after a successful one.

**And the guard that exists for this walked past all three.**
`test/no-dead-route-in-copy.test.ts` skipped any file under `app/api/v*`,
reasoning that "a route file naming its own path is the authority on it". True
of the route's own path and of nothing else in the file — so every other string
in every v1 and v2 route file was exempt, which is most of the caller-facing
copy this API has.

## Work

- Repoint the three strings at the doors that exist.
- Narrow the exemption to the file's own path, derived from its directory.
- Keep the `moved from` / `was` escape hatch for history.

## Acceptance

- `POST /api/v2/{user}/import`'s answer names a track route that resolves.
- The guard fails if a route file names any other dead route.

## Done, 2026-09-14

All three repointed. The exemption is now the file's own path only, derived
from its directory (`app/api/v2/[user]/import` → `/api/v2/{user}/import`), and
narrowing it is what found the third and worst one. `npm run verify` — all 5
passed.
