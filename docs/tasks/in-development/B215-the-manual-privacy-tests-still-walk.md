---
id: B215
title: The manual privacy tests still walk an operator through a trip password
type: ISSUE
priority: medium
complexity: low
area: docs, qa
found: "2026-09-04T06:33:34Z"
started: "2026-09-04T09:30:25Z"
session: 7d30451d-0304-4631-8484-d96036fb11b4
claimed: "2026-09-04T09:30:25Z"
---

# B215 — The manual privacy tests still walk an operator through a trip password

## Why

Found while doing B81, and deliberately not absorbed into it: B81 is one
sentence in `scripts/notify.mts`, this is a whole scenario table.

`docs/TESTING.md` section F — "Privacy", introduced with "this is where a
mistake would be expensive, so test it properly" — is twelve steps, and the
first four cannot be performed:

| Step | Says | Reality |
| --- | --- | --- |
| F1 | `npm run trip:password -- "familie2026"` | No such script. `package.json` has no `trip:password`, and `scripts/trip-password.mjs` does not exist. |
| F2 | write `passwordHash:` and `visibility: password` | B39 removed the scrypt hash, the signed cookie and the unlock form. `visibility` takes `private`, `public` or `guest`; anything else reads as `private`. |
| F3–F6 | a password form, a wrong password, the right one, and it staying unlocked | There is no form. The gate is `components/TripGate.tsx`, and it asks for an e-mail address. |
| F10 | `visibility: unlisted` | W27 split that into two fields. It is `listed: false` on a `public` trip now, and `listed: true` on a trip no visibility advertises is refused (B51). |

F7 to F9 are still exactly right and are the valuable half — a private trip's
photos must 404 by URL, it must be in neither the sitemap nor the feed, and the
rest of the journal must keep working.

The cost is not that the steps fail; it is that the one document an operator is
pointed at to check privacy before shipping cannot be completed, so it stops
being run at all — and the three checks that do still matter go with it.

## Work

- Rewrite F1–F6 against the mechanism that exists: set `visibility: guest` or
  `private` on a trip, meet the gate, and confirm it names the journal and not
  the trip (B117). Signing in alone must open nothing; a grant is what opens a
  `guest` trip and `people:` is what opens a `private` one.
- Replace F10 with `listed: false`, and add the refusal in B51 as a step.
- Keep F7, F8, F9 as they are.
- Grep `docs/` for `passwordHash`, `trip:password` and `visibility: password`
  while there.

Not doing: `docs/plans/`, which is the record of intent before the work and is
deliberately never updated (`docs/plans/INDEX.md` says so, and
`test/docs-links.test.ts` excludes it for that reason).

## Acceptance

- Every step of section F can be performed against a local dev server.
- `grep -rn 'trip:password\|passwordHash' docs/` finds nothing outside
  `docs/tasks/` and `docs/plans/`.
- The four checks.
